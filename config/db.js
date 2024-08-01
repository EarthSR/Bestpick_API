const mysql = require('mysql2');

const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '1234',
  database: 'shopee'
});

connection.connect(err => {
  if (err) throw err;
  console.log('Connected to the MySQL server.');
});

module.exports = connection;
