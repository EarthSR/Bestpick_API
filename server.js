const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors()); // Enable CORS


// Initialize Firebase Admin SDK
const serviceAccount = require('./config/apilogin-6efd6-firebase-adminsdk-b3l6z-c2e5fe541a.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // Optionally you can add databaseURL here
});

// Database connection (TiDB compatible with SSL)
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: {
    ca: fs.readFileSync('./certs/isrgrootx1.pem'), // Replace with the actual path to your CA certificate
  }
});

connection.connect(err => {
  if (err) {
    console.error('Error connecting to the database:', err);
    return;
  }
  console.log('Connected to the TiDB server.');
});

// In-memory store for failed login attempts
const failedLoginAttempts = {};

// Register route
app.post('/register', (req, res) => {
  const { username, password } = req.body;

  const checkSql = 'SELECT * FROM users WHERE email = ?';
  connection.query(checkSql, [username], (err, results) => {
    if (err) {
      return res.json({ error: 'Database error during username check' });
    }
    if (results.length > 0) {
      return res.json({ error: 'email already in use' });
    }

    bcrypt.hash(password, 10, (err, hash) => {
      if (err) {
        return res.json({ error: 'Error hashing password' });
      }
      const sql = 'INSERT INTO users (email, password) VALUES (?, ?)';
      connection.query(sql, [username, hash], (err, result) => {
        if (err) {
          return res.json({ error: 'Database error during registration' });
        }
        res.status(201).json({ message: 'User registered successfully' });
      });
    });
  });
});

// Login route
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  // Check if the user is locked out
  if (failedLoginAttempts[username] && failedLoginAttempts[username].count >= 5) {
    const now = Date.now();
    const timeSinceLastAttempt = now - failedLoginAttempts[username].lastAttempt;
    if (timeSinceLastAttempt < 300000) { // 5 minutes in milliseconds
      return res.status(429).send({ message: 'Too many failed login attempts. Try again in 5 minutes.' });
    } else {
      // Reset the failed attempts counter after the lockout period
      failedLoginAttempts[username].count = 0;
    }
  }

  const sql = 'SELECT * FROM users WHERE email = ?';
  connection.query(sql, [username], (err, results) => {
    if (err) throw err;

    if (results.length === 0) {
      return res.send({ message: 'No user found' });
    }

    const user = results[0];
    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) throw err;

      if (!isMatch) {
        // Track the failed login attempt
        if (!failedLoginAttempts[username]) {
          failedLoginAttempts[username] = { count: 1, lastAttempt: Date.now() };
        } else {
          failedLoginAttempts[username].count++;
          failedLoginAttempts[username].lastAttempt = Date.now();
        }

        const remainingAttempts = 5 - failedLoginAttempts[username].count;
        return res.send({ message: `Password is incorrect. You have ${remainingAttempts} attempts left.` });
      }

      // Reset the failed attempts counter on successful login
      if (failedLoginAttempts[username]) {
        failedLoginAttempts[username].count = 0;
      }

      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

      // Fetch all user data
      const userSql = 'SELECT * FROM users WHERE id = ?';
      connection.query(userSql, [user.id], (err, userData) => {
        if (err) throw err;

        res.send({
          message: 'Authentication successful',
          token,
          user: userData[0]
        });
      });
    });
  });
});

// Verify Firebase ID Token
async function verifyFirebaseToken(token) {
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    throw new Error('Invalid Firebase token');
  }
}

// Google Sign-In route
app.post('/google-signin', async (req, res) => {
  const { token } = req.body;

  try {
    const decodedToken = await verifyFirebaseToken(token);
    console.log('Decoded Token:', decodedToken); // Log decoded token
    const { email, uid: googleId, name, picture } = decodedToken;

    // Check if the user already exists
    const checkSql = 'SELECT * FROM users WHERE google_id = ?';
    connection.query(checkSql, [googleId], (err, results) => {
      if (err) {
        return res.status(500).json({ error: 'Database error during Google ID check' });
      }

      if (results.length > 0) {
        // User exists, log them in
        const user = results[0];
        const jwtToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        return res.json({
          message: 'Authentication successful',
          token: jwtToken,
          user
        });
      } else {
        // User doesn't exist, register them
        const registerSql = 'INSERT INTO users (google_id, name, email, picture) VALUES (?, ?, ?, ?)';
        connection.query(registerSql, [googleId, name, email, picture], (err, result) => {
          if (err) {
            return res.status(500).json({ error: 'Database error during Google registration' });
          }

          const userId = result.insertId;
          const jwtToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });

          return res.status(201).json({
            message: 'User registered and authenticated successfully',
            token: jwtToken,
            user: {
              id: userId,
              username: email,
              google_id: googleId,
              name,
              email,
              picture
            }
          });
        });
      }
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid Firebase token' });
  }
});



// Verify Facebook token and get user data
async function verifyFacebookToken(token) {
  try {
    const response = await axios.get('https://graph.facebook.com/me', {
      params: {
        access_token: token,
        fields: 'id,name,email,picture',
      },
    });
    return response.data;
  } catch (error) {
    console.error('Error verifying Facebook token:', error);
    throw new Error('Invalid Facebook token');
  }
}

// Facebook Sign-In route
app.post('/facebook-signin', async (req, res) => {
  const { token } = req.body;

  try {
    // Verify and decode the Facebook token
    const userData = await verifyFacebookToken(token);
    console.log('Decoded Token:', userData);

    const { id: facebookId, name, email, picture } = userData;
    const pictureUrl = picture?.data?.url || ''; // Ensure picture URL exists

    // Check if the user already exists in the database
    const checkSql = 'SELECT * FROM users WHERE facebook_id = ?';
    connection.query(checkSql, [facebookId], (err, results) => {
      if (err) {
        console.error('Database error during Facebook ID check:', err);
        return res.status(500).json({ error: 'Database error during Facebook ID check' });
      }

      if (results.length > 0) {
        // User exists, log them in
        const user = results[0];
        const jwtToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        return res.json({
          message: 'Authentication successful',
          token: jwtToken,
          user,
        });
      } else {
        // User doesn't exist, register them
        const registerSql = 'INSERT INTO users (facebook_id, name, email, picture) VALUES (?, ?, ?, ?)';
        connection.query(registerSql, [facebookId, name, email, pictureUrl], (err, result) => {
          if (err) {
            console.error('Database error during Facebook registration:', err);
            return res.status(500).json({ error: 'Database error during Facebook registration' });
          }

          const userId = result.insertId;
          const jwtToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });

          return res.status(201).json({
            message: 'User registered and authenticated successfully',
            token: jwtToken,
            user: {
              id: userId,
              facebook_id: facebookId,
              name,
              email,
              picture: pictureUrl,
            },
          });
        });
      }
    });
  } catch (error) {
    console.error('Facebook authentication error:', error);
    res.status(401).json({ error: 'Invalid Facebook token' });
  }
});


// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
