const express = require('express');
const { Client } = require('pg');
const fs = require('fs');
const axios = require('axios');
const app = express();
const secrets_file = fs.readFileSync('./secrets.json', 'utf-8');
const secrets_data = JSON.parse(secrets_file);
const port = secrets_data.ports.me;
const riotapikey = secrets_data.riotapi.key;

const client = new Client({
  user: secrets_data.db.user, // 데이터베이스 사용자명
  host: secrets_data.db.host,
  database: secrets_data.db.database, // 데이터베이스 이름
  password: secrets_data.db.password, // 데이터베이스 비밀번호
  port: secrets_data.ports.db,
});
client.connect().catch(err => console.error('Error connecting to the database', err.stack));

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
})

app.get('/api', (req, res) => {
  res.send('Hi, This is Jambaram.xyz\'s NODE API SERVER');
})

app.get('/api/summoner/find', async (req, res) => {
  var gamename = req.query.name;
  var tagline = req.query.tag;
  
  if (!gamename || !tagline) {
    return res.status(400).send('name n tag query parameter is required');
  }

  try {
    var query = `
      SELECT *
      FROM summoner
      WHERE gamename = $1
      AND tagline = $2
    `;
    var result = await client.query(query, [gamename, tagline]);
    var matchdetail = null;
    
    if (result.rows.length == 0) //DB에 없음
    {
      try {
        var summonerResponse = await axios.get(`https://asia.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${gamename}/${tagline}?api_key=${riotapikey}`);
        var puuid = summonerResponse.data.puuid;
        var summonerDetailsResponse = await axios.get(`https://kr.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}?api_key=${riotapikey}`);
        var summonerDetails = summonerDetailsResponse.data;

        var insertQuery = `
          INSERT INTO summoner (gamename, tagline, puuid, profileiconid, summonerlevel)
          VALUES ($1, $2, $3, $4, $5)
        `;
        await client.query(insertQuery, [
          gamename,
          tagline,
          puuid,
          summonerDetails.profileIconId,
          summonerDetails.summonerLevel
        ]);
      } 
      catch (apiError) {
        if (apiError.response.status == 404) {
          res.status(404).send('Summoner not found');
        } 
        else {
          res.status(500).send('Error fetching summoner data from Riot API');
        }
      }
      result = await client.query(query, [gamename, tagline]);
    }
    else if (result.rows[0].revisiondate != null) { //DB에 소환사 정보가 있고, 전적갱신을 누른적이 있는사람
      //매치데이터도 띄워야대요
      //match에서 name+tag가 일치하는 모든 매치데이터 갖고오기
      //const find_id_from_match_query = 'SELECT * FROM match WHERE '
      //matchdetail = 'yes it is'
    }
    res.json({summoner: result.rows[0], matchdetail: matchdetail});
  }
  catch (error) {
    res.status(500).send('Error checking database');
  }
});

app.get('/api/summoner/update', async (req, res) => {
  var puuid = req.query.puuid;

  if (!puuid) {
    return res.status(400).send('puuid query parameter is required');
  }

  try { //RF9Gz-Kn6VS7uRC46CCZsLhXA7mSmeQp_RR1C5pcs9Y5zGVv-yqAfH79oY2ULY1-fHJch049e22EPg
    var matchlistResponse = await axios.get(`https://asia.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=450&start=0&count=20&api_key=${riotapikey}`);
    var matchlist = matchlistResponse.data;

    for (let matchid of matchlist) {
      var matchCheckQuery = `SELECT id FROM match WHERE id = $1`;
      var matchCheckResult = await client.query(matchCheckQuery, [matchid]);
      
      if (matchCheckResult.rows.length == 0) { //doesnt exist in DB
        try {
          var matchDetailResponse = await axios.get(`https://asia.api.riotgames.com/lol/match/v5/matches/${matchid}?api_key=${riotapikey}`);
          var matchDetail = matchDetailResponse.data;

          var insertMatchQuery = `
            INSERT INTO match (id, participant)
            VALUES ($1, $2)
          `;
          var participants = matchDetail.metadata.participants;
          await client.query(insertMatchQuery, [matchid, participants]);
          console.log('not in db, insert complete');
          
        }
        catch (matchDetailError) {
          return res.status(500).send('Error fetching match detail from Riot API');
        }

        const insertMatchdetailQuery = `
            INSERT INTO match_detail (id, participant, kill, death, assist, kda,
                                      championid, spell_d, spell_f, rune_main, rune_sub,
                                      item, best_streak_kill, pkill, cs)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, %15)
        `;

        var participants = [];
        const kills = [];
        const deaths = [];
        const assists = [];
        const kdas = [];
        const championIds = [];
        const spellDs = [];
        const spellFs = [];
        const runeMains = [];
        const runeSubs = [];
        const itemsArray = [];
        const bestStreakKills = [];
        const pKills = [];
        const csArray = [];

        const participantsData = matchDetail.info.participants;
        
        for (let participant of participantsData) {
          const {
            summonerName,
            kills: kill,
            deaths: death,
            assists: assist,
            kda,
            championId,
            summoner1Id,
            summoner2Id,
            perks,
            item0, item1, item2, item3, item4, item5, item6,
            largestKillingSpree,
            totalMinionsKilled,
            participantId
          } = participant;

          participants.push(summonerName);
          kills.push(kill);
          deaths.push(death);
          assists.push(assist);
          kdas.push((kill+assist) / death);
          championIds.push(championId);
          spellDs.push(summoner1Id);
          spellFs.push(summoner2Id);
          
          const runesMain = perks.styles[0].selections.map(s => s.perk);
          const runesSub = perks.styles[1].selections.map(s => s.perk);

          runeMains.push(runesMain[0] || null); // assuming runesMain[0] is primary and required
          runeSubs.push(runesSub[0] || null);  // assuming runesSub[0] is secondary and required

          itemsArray.push([item0, item1, item2, item3, item4, item5, item6]);
          bestStreakKills.push(largestKillingSpree);
          pKills.push(participantId);
          csArray.push(totalMinionsKilled);
        }

        console.log(runeMains, runeSubs, itemsArray, bestStreakKills, pKills, csArray);

        console.log('insert complete');
        //await client.query(insertMatchdetailQuery, [matchid, participants]);

        
        //matchdetail쭉 넣고 match_detail테이블에 insert
      }
      else {
        console.log('already exist in db');
      }

      res.json({matchDetail: matchdetail_kill});

      //해당 매치는 match테이블에 있는지 확인 완료, 따라서 match_detail 테이블에
      
      break;
    }
  }
  catch (apiError) {
    res.status(500).send('Error updating summoner data');
  }

  //각 경기가 match테이블의 id에 있는지 검색. 
  //Case1. DB에 있으면 
  //Case 2. 없으면 riotapi에 요청, match 테이블 채우고, match_detail 테이블도 채운다.
  //그리고 각 매치마다 특정지표를 모아서 summoner 테이블 채워야함.
  //puuid, profileiconid, summonerlevel, revisiondate 갱신 (api 요청)
})


/*
SELECT *
FROM users
WHERE name = '특정값'
ORDER BY created_at DESC
LIMIT 20;
*/