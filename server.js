const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors()); // Enable CORS


// Initialize Firebase Admin SDK
const serviceAccount = require('./config/apilogin-6efd6-firebase-adminsdk-b3l6z-c2e5fe541a.json');
const e = require('express');

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

// Generate OTP
function generateOtp() {
  const otp = crypto.randomBytes(3).toString('hex'); // 3 bytes = 6 hex characters
  return parseInt(otp, 16).toString().slice(0, 6); // Convert to an integer and then take the first 6 digits
}

// Send OTP to the user's email
function sendOtpEmail(email, otp, callback) {
  const transporter = nodemailer.createTransport({
      service: 'Gmail',
      auth: {
          user: process.env.email,
          pass: process.env.emailpassword
      }
  });

  const mailOptions = {
      from: process.env.email,
      to: email,
      subject: 'Your OTP Code',
      text: `Your OTP code is ${otp}`
  };

  transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
          return callback(error);
      }
      callback(null, info);
  });
}

function sendResetOTPEmail(email, OTP, callback) {
  // Create a transporter object using SMTP transport
  const transporter = nodemailer.createTransport({
      service: 'Gmail', 
      auth: {
        user: process.env.email,
        pass: process.env.emailpassword
      }
  });

  // Email options
  const mailOptions = {
      from: process.env.email, // Sender address
      to: email,                   // List of recipients
      subject: 'Password Reset Request', // Subject line
      text: `Here is your password reset OTP: ${OTP}\n\nThe OTP is valid for 10 minutes. If you didn't request this, please ignore this email.`, // Plain text body
      html: `<p>Here is your password reset OTP: <strong>${OTP}</strong></p><p>The OTP is valid for 10 minutes. If you didn't request this, please ignore this email.</p>` // HTML body
  };

  // Send email
  transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
          return callback(error);
      }
      callback(null, info);
  });
}

app.post('/register/email', (req, res) => {
  const { email } = req.body;

  const checkSql = 'SELECT * FROM users WHERE email = ?';
  connection.query(checkSql, [email], (err, results) => {
      if (err) {
          console.error('Database error during email check:', err);
          return res.status(500).json({ error: 'Internal server error' });
      }
      if (results.length > 0) {
          return res.status(400).json({ error: 'Email already in use' });
      }

      const otp = generateOtp();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

      // Save OTP in your database with expiration time
      const saveOtpSql = 'INSERT INTO otps (email, otp, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE otp = ?, expires_at = ?';
      connection.query(saveOtpSql, [email, otp, expiresAt, otp, expiresAt], (err, result) => {
          if (err) {
              console.error('Database error during OTP save:', err);
              return res.status(500).json({ error: 'Internal server error' });
          }

          // Use the sendOtpEmail function to send the OTP email
          sendOtpEmail(email, otp, (error, info) => {
              if (error) {
                  console.error('Error sending OTP email:', error);
                  return res.status(500).json({ error: 'Error sending OTP email' });
              }
              res.status(200).json({ message: 'OTP sent to email' });
          });
      });
  });
});



// Step 2: Verify OTP
app.post('/register/verify-otp', (req, res) => {
  const { email, otp } = req.body;

  const verifyOtpSql = 'SELECT otp, expires_at FROM otps WHERE email = ? AND otp = ?';
  connection.query(verifyOtpSql, [email, otp], (err, results) => {
      if (err) {
          console.error('Database error during OTP verification:', err);
          return res.status(500).json({ error: 'Internal server error' });
      }
      if (results.length === 0) {
          return res.status(400).json({ error: 'Invalid OTP' });
      }

      const { expires_at } = results[0];
      const now = new Date();

      if (now > new Date(expires_at)) {
          // OTP has expired
          return res.status(400).json({ error: 'OTP has expired' });
      }

      // OTP verified and valid, now the user can proceed to set a password
      res.status(200).json({ message: 'OTP verified, you can set your password now' });
  });
});


// Step 3: Register User
app.post('/register/set-password', (req, res) => {
  const { email, password } = req.body;

  bcrypt.hash(password, 10, (err, hash) => {
      if (err) {
          return res.json({ error: 'Error hashing password' });
      }

      const sql = 'INSERT INTO users (email, password) VALUES (?, ?)';
      connection.query(sql, [email, hash], (err, result) => {
          if (err) {
              return res.json({ error: 'Database error during registration' });
          }

          // Remove the OTP entry as it's no longer needed
          const deleteOtpSql = 'DELETE FROM otps WHERE email = ?';
          connection.query(deleteOtpSql, [email], (err, result) => {
              if (err) {
                  return res.json({ error: 'Database error during OTP cleanup' });
              }

              res.status(201).json({ message: 'User registered successfully' });
          });
      });
  });
});


app.post('/resend-otp', (req, res) => {
  const { email } = req.body;

  const findOtpSql = 'SELECT otp, expires_at FROM otps WHERE email = ?';
  connection.query(findOtpSql, [email], (err, results) => {
      if (err) {
          console.error('Database error during OTP lookup:', err);
          return res.status(500).json({ error: 'Internal server error' });
      }
      if (results.length === 0) {
          return res.status(400).json({ error: 'No OTP found for this email. Please register first.' });
      }

      const { otp, expires_at } = results[0];
      const now = new Date();

      if (now > new Date(expires_at)) {
          // If OTP has expired, generate a new one
          const newOtp = generateOtp();
          const newExpiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes from now
          const updateOtpSql = 'UPDATE otps SET otp = ?, expires_at = ? WHERE email = ?';
          connection.query(updateOtpSql, [newOtp, newExpiresAt, email], (err, result) => {
              if (err) {
                  console.error('Database error during OTP update:', err);
                  return res.status(500).json({ error: 'Internal server error' });
              }

              // Send the new OTP
              sendOtpEmail(email, newOtp, (error, info) => {
                  if (error) {
                      console.error('Error sending new OTP email:', error);
                      return res.status(500).json({ error: 'Error sending OTP email' });
                  }
                  res.status(200).json({ message: 'New OTP sent to email' });
              });
          });
      } else {
          // OTP is still valid, resend the existing one
          sendOtpEmail(email, otp, (error, info) => {
              if (error) {
                  console.error('Error resending OTP email:', error);
                  return res.status(500).json({ error: 'Error sending OTP email' });
              }
              res.status(200).json({ message: 'OTP resent to email' });
          });
      }
  });
});



app.post('/forgot-password', (req, res) => {
  const { email } = req.body;

  // Check if the email exists
  const userCheckSql = 'SELECT * FROM users WHERE email = ?';
  connection.query(userCheckSql, [email], (err, results) => {
      if (err) {
          console.error('Database error during email check:', err);
          return res.status(500).json({ error: 'Internal server error' });
      }
      if (results.length === 0) {
          return res.status(400).json({ error: 'Email not found' });
      }

      const otp = generateOtp(); // Implement otp generation
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

      // Save otp and expiration time in the database
      const saveOtpSql = 'INSERT INTO password_resets (email, otp, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE otp = ?, expires_at = ?';
      connection.query(saveOtpSql, [email, otp, expiresAt, otp, expiresAt], (err, result) => {
          if (err) {
              console.error('Database error during otp save:', err);
              return res.status(500).json({ error: 'Internal server error' });
          }

          // Send otp via email
          sendResetOTPEmail(email, otp, (error, info) => {
              if (error) {
                  console.error('Error sending reset otp email:', error);
                  return res.status(500).json({ error: 'Error sending reset otp email' });
              }
              res.status(200).json({ message: 'Password reset otp sent to email' });
          });
      });
  });
});

app.post('/verify-reset-otp', (req, res) => {
  const { email, otp } = req.body;

  const verifyOtpSql = 'SELECT otp, expires_at FROM password_resets WHERE email = ? AND otp = ?';
  connection.query(verifyOtpSql, [email, otp], (err, results) => {
      if (err) {
          console.error('Database error during otp verification:', err);
          return res.status(500).json({ error: 'Internal server error' });
      }
      if (results.length === 0) {
          return res.status(400).json({ error: 'Invalid or expired otp' });
      }

      const { expires_at } = results[0];
      const now = new Date();

      if (now > new Date(expires_at)) {
          // otp has expired
          return res.status(400).json({ error: 'otp has expired' });
      }

      // otp is valid
      res.status(200).json({ message: 'otp is valid, you can set a new password' });
  });
});

app.post('/reset-password', (req, res) => {
    const { email, otp, newPassword } = req.body;

    // Verify the OTP
    const verifyOtpSql = 'SELECT expires_at FROM password_resets WHERE email = ? AND otp = ?';
    connection.query(verifyOtpSql, [email, otp], (err, results) => {
        if (err) {
            console.error('Database error during OTP verification:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
        if (results.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

        const { expires_at } = results[0];
        const now = new Date();

        if (now > new Date(expires_at)) {
            // OTP has expired
            return res.status(400).json({ error: 'OTP has expired' });
        }

        // OTP is valid, hash the new password
        bcrypt.hash(newPassword, 10, (err, hashedPassword) => {
            if (err) {
                console.error('Error hashing password:', err); // Log the detailed error
                return res.status(500).json({ error: 'Error hashing password' });
            }

            // Update the user's password
            const updatePasswordSql = 'UPDATE users SET password = ? WHERE email = ?';
            connection.query(updatePasswordSql, [hashedPassword, email], (err, result) => {
                if (err) {
                    console.error('Database error during password update:', err);
                    return res.status(500).json({ error: 'Internal server error' });
                }

                // Optionally, delete the used OTP
                const deleteOtpSql = 'DELETE FROM password_resets WHERE email = ? AND otp = ?';
                connection.query(deleteOtpSql, [email, otp], (err, result) => {
                    if (err) {
                        console.error('Database error during OTP deletion:', err);
                    }
                    res.status(200).json({ message: 'Password has been updated successfully' });
                });
            });
        });
    });
});




// Login route
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  // Check if the user is locked out
  if (failedLoginAttempts[email] && failedLoginAttempts[email].count >= 5) {
    const now = Date.now();
    const timeSinceLastAttempt = now - failedLoginAttempts[email].lastAttempt;
    if (timeSinceLastAttempt < 300000) { // 5 minutes in milliseconds
      return res.status(429).send({ message: 'Too many failed login attempts. Try again in 5 minutes.' });
    } else {
      // Reset the failed attempts counter after the lockout period
      failedLoginAttempts[email].count = 0;
    }
  }

  const sql = 'SELECT * FROM users WHERE email = ?';
  connection.query(sql, [email], (err, results) => {
    if (err) throw err;

    if (results.length === 0) {
      return res.send({ message: 'No user found' });
    }

    const user = results[0];
    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) throw err;

      if (!isMatch) {
        // Track the failed login attempt
        if (!failedLoginAttempts[email]) {
          failedLoginAttempts[email] = { count: 1, lastAttempt: Date.now() };
        } else {
          failedLoginAttempts[email].count++;
          failedLoginAttempts[email].lastAttempt = Date.now();
        }

        const remainingAttempts = 5 - failedLoginAttempts[email].count;
        return res.send({ message: `Password is incorrect. You have ${remainingAttempts} attempts left.` });
      }

      // Reset the failed attempts counter on successful login
      if (failedLoginAttempts[email]) {
        failedLoginAttempts[email].count = 0;
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

app.post('/google-signin', (req, res) => {
  const { googleId, email, name, picture } = req.body;

  // Validate the input
  if (!googleId || !email || !name || !picture) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  console.log('Received data from client:', { googleId, email, name, picture });

  // Check if the user already exists in the database
  const checkSql = 'SELECT * FROM users WHERE google_id = ? OR email = ?';
  connection.query(checkSql, [googleId, email], (err, results) => {
    if (err) {
      console.error('Database error during Google ID or email check:', err);
      return res.status(500).json({ error: 'Database error during check' });
    }

    if (results.length > 0) {
      // User exists, return user info
      const user = results[0];
      return res.json({
        message: 'User information fetched successfully',
        user: {
          id: user.id,
          email: user.email,
          google_id: user.google_id,
          name: user.name,
          picture: user.picture
        }
      });
    } else {
      // User does not exist, insert new user
      const insertSql = 'INSERT INTO users (google_id, email, name, picture) VALUES (?, ?, ?, ?)';
      connection.query(insertSql, [googleId, email, name, picture], (err, result) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY') {
            console.error('Duplicate entry error:', err);
            return res.status(409).json({ error: 'Email already registered' });
          } else {
            console.error('Database error during user insertion:', err);
            return res.status(500).json({ error: 'Database error during registration' });
          }
        }

        // Fetch the newly inserted user
        const newUserId = result.insertId;
        const newUserSql = 'SELECT * FROM users WHERE id = ?';
        connection.query(newUserSql, [newUserId], (err, results) => {
          if (err) {
            console.error('Database error during new user fetch:', err);
            return res.status(500).json({ error: 'Database error during new user fetch' });
          }

          const newUser = results[0];
          return res.status(201).json({
            message: 'successfully',
            user: {
              id: newUser.id,
              email: newUser.email,
              google_id: newUser.google_id,
              name: newUser.name,
              picture: newUser.picture
            }
          });
        });
      });
    }
  });
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
