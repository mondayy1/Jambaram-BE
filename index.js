const express = require('express')
const app = express()
const port = 10050

app.get('/api', (req, res) => {
  res.send('Hello World!, This is Jambaram.xyz\'s API SERVER')
})

app.listen(port, '127.0.0.1', () => {
  console.log(`Example app listening on port ${port}`)
})