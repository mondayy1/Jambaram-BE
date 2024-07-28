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
          console.log('no search results');
          res.status(404).send('Summoner not found');
        } 
        else {
          console.error('Error fetching summoner data from Riot API', apiError.stack);
          res.status(500).send('Error fetching summoner data from Riot API');
        }
      }
      result = await client.query(query, [gamename, tagline]);
    }
    else if (result.rows[0].revisiondate != null) { //DB에 소환사 정보가 있고, 전적갱신을 누른적이 있는사람
      //매치데이터도 띄워야대요 시팔!!!
      //match에서 name+tag가 일치하는 모든 매치데이터 갖고오기
      //const find_id_from_match_query = 'SELECT * FROM match WHERE '
      //matchdetail = 'yes it is'
    }
    res.json({summoner: result.rows[0], matchdetail: matchdetail});
  }
  catch (error) {
    console.error('Error executing query', error.stack);
    res.status(500).send('Error checking database');
  }
});

app.get('/api/summoner/update', async (req, res) => {
  var gamename = req.query.name;
  var tagline = req.query.tag;

  if (!gamename || !tagline) {
    return res.status(400).send('name n tag query parameter is required');
  }
//#3, 전적갱신 버튼 누르면
//일단 revisiondate 갱신, riotapi로 puuid 조회, 최근 칼바람 20판을 조회. 각 경기가 match테이블의 id에 있는지 for문으로 검색. 
//Case 1. DB에 있으면 그걸로 띄우기
//Case 2. 없으면 riotapi에 요청, 
//
})
