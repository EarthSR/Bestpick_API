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
const JWT_SECRET = process.env.JWT_SECRET;
const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors()); // Enable CORS

// Initialize Firebase Admin SDK
const serviceAccount = require('./config/apilogin-6efd6-firebase-adminsdk-b3l6z-c2e5fe541a.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
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
  return parseInt(otp, 16).toString().slice(0, 4); 
}

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
    html: `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2 style="color: #007bff;">Your OTP Code</h2>
        <p>Hello,</p>
        <p>We received a request to verify your email address. Please use the OTP code below to complete the process:</p>
        <div style="padding: 10px; border: 2px solid #007bff; display: inline-block; font-size: 24px; color: #007bff; font-weight: bold;">
          ${otp}
        </div>
        <p>This code will expire in 10 minutes.</p>
        <p>If you didn’t request this, please ignore this email.</p>
        <p style="margin-top: 20px;">Thanks, <br> The Team</p>
        <hr>
        <p style="font-size: 12px; color: #999;">This is an automated email, please do not reply.</p>
      </div>
    `
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Error sending OTP email:', error); // Log the error for debugging purposes
      return callback({ error: 'Failed to send OTP email. Please try again later.' });
    }
    callback(null, info); // Proceed if the email was successfully sent
  });
}


// Register a new email user
app.post('/register/email', async (req, res) => {
  try {
    const { email } = req.body;
    const checkRegisteredSql = 'SELECT * FROM users WHERE email = ? AND password IS NOT NULL';

    connection.query(checkRegisteredSql, [email], (err, results) => {
      if (err) throw new Error('Database error during email registration check');
      if (results.length > 0) return res.status(400).json({ error: 'Email already registered' });

      const checkSql = 'SELECT * FROM users WHERE email = ? AND password IS NULL';
      connection.query(checkSql, [email], (err, results) => {
        if (err) throw new Error('Database error during email check');
        if (results.length > 0) return res.status(400).json({ error: 'Email already in use or used in another sign-in' });

        const otp = generateOtp();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        const findOtpSql = 'SELECT * FROM otps WHERE email = ?';
        connection.query(findOtpSql, [email], (err, otpResults) => {
          if (err) throw new Error('Database error during OTP retrieval');

          if (otpResults.length > 0) {
            const updateOtpSql = 'UPDATE otps SET otp = ?, expires_at = ? WHERE email = ?';
            connection.query(updateOtpSql, [otp, expiresAt, email], (err) => {
              if (err) throw new Error('Database error during OTP update');
              sendOtpEmail(email, otp, (error) => {
                if (error) throw new Error('Error sending OTP email');
                res.status(200).json({ message: 'OTP sent to email' });
              });
            });
          } else {
            const insertOtpSql = 'INSERT INTO otps (email, otp, expires_at) VALUES (?, ?, ?)';
            connection.query(insertOtpSql, [email, otp, expiresAt], (err) => {
              if (err) throw new Error('Database error during OTP insertion');
              sendOtpEmail(email, otp, (error) => {
                if (error) throw new Error('Error sending OTP email');
                res.status(200).json({ message: 'OTP sent to email' });
              });
            });
          }
        });
      });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify OTP
app.post('/register/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const verifyOtpSql = 'SELECT otp, expires_at FROM otps WHERE email = ? AND otp = ?';
    
    connection.query(verifyOtpSql, [email, otp], (err, results) => {
      if (err) throw new Error('Database error during OTP verification');
      if (results.length === 0) return res.status(400).json({ error: 'Invalid OTP' });

      const { expires_at } = results[0];
      const now = new Date();

      if (now > new Date(expires_at)) return res.status(400).json({ error: 'OTP has expired' });

      res.status(200).json({ message: 'OTP verified, you can set your password now' });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Register User
app.post('/register/set-password', async (req, res) => {
  try {
    const { email, password } = req.body;
    const hash = await bcrypt.hash(password, 10);

    const sql = 'INSERT INTO users (email, password) VALUES (?, ?)';
    connection.query(sql, [email, hash], (err) => {
      if (err) throw new Error('Database error during registration');

      const deleteOtpSql = 'DELETE FROM otps WHERE email = ?';
      connection.query(deleteOtpSql, [email], (err) => {
        if (err) throw new Error('Database error during OTP cleanup');
        res.status(201).json({ message: 'User registered successfully' });
      });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Resend OTP for Registration
app.post('/resend-otp/register', async (req, res) => {
  try {
    const { email } = req.body;
    const findOtpSql = 'SELECT otp, expires_at FROM otps WHERE email = ?';

    connection.query(findOtpSql, [email], (err, results) => {
      if (err) throw new Error('Database error during OTP lookup');
      if (results.length === 0) return res.status(400).json({ error: 'No OTP found for this email. Please register first.' });

      const { otp, expires_at } = results[0];
      const now = new Date();

      if (now > new Date(expires_at)) {
        const newOtp = generateOtp();
        const newExpiresAt = new Date(now.getTime() + 10 * 60 * 1000);
        const updateOtpSql = 'UPDATE otps SET otp = ?, expires_at = ? WHERE email = ?';
        connection.query(updateOtpSql, [newOtp, newExpiresAt, email], (err) => {
          if (err) throw new Error('Database error during OTP update');
          sendOtpEmail(email, newOtp, (error) => {
            if (error) throw new Error('Error sending OTP email');
            res.status(200).json({ message: 'New OTP sent to email' });
          });
        });
      } else {
        sendOtpEmail(email, otp, (error) => {
          if (error) throw new Error('Error resending OTP email');
          res.status(200).json({ message: 'OTP resent to email' });
        });
      }
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Forgot Password
app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const userCheckSql = 'SELECT * FROM users WHERE email = ? AND password IS NOT NULL';

    connection.query(userCheckSql, [email], (err, userResults) => {
      if (err) throw new Error('Database error during email check');
      if (userResults.length === 0) return res.status(400).json({ error: 'Email not found' });

      const otp = generateOtp();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      const otpCheckSql = 'SELECT * FROM password_resets WHERE email = ?';
      connection.query(otpCheckSql, [email], (err, otpResults) => {
        if (err) throw new Error('Database error during OTP check');

        if (otpResults.length > 0) {
          const updateOtpSql = 'UPDATE password_resets SET otp = ?, expires_at = ? WHERE email = ?';
          connection.query(updateOtpSql, [otp, expiresAt, email], (err) => {
            if (err) throw new Error('Database error during OTP update');
            sendOtpEmail(email, otp, (error) => {
              if (error) throw new Error('Error sending OTP email');
              res.status(200).json({ message: 'OTP sent to email' });
            });
          });
        } else {
          const saveOtpSql = 'INSERT INTO password_resets (email, otp, expires_at) VALUES (?, ?, ?)';
          connection.query(saveOtpSql, [email, otp, expiresAt], (err) => {
            if (err) throw new Error('Database error during OTP save');
            sendOtpEmail(email, otp, (error) => {
              if (error) throw new Error('Error sending OTP email');
              res.status(200).json({ message: 'OTP sent to email' });
            });
          });
        }
      });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify Reset OTP
app.post('/verify-reset-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

    const verifyOtpSql = 'SELECT otp, expires_at FROM password_resets WHERE email = ? AND otp = ?';
    connection.query(verifyOtpSql, [email, otp], (err, results) => {
      if (err) throw new Error('Database error during OTP verification');
      if (results.length === 0) return res.status(400).json({ error: 'Invalid OTP or email' });

      const { expires_at } = results[0];
      const now = new Date();

      if (now > new Date(expires_at)) return res.status(400).json({ error: 'OTP has expired' });

      res.status(200).json({ message: 'OTP is valid, you can set a new password' });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset Password
app.post('/reset-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const updatePasswordSql = 'UPDATE users SET password = ? WHERE email = ?';
    connection.query(updatePasswordSql, [hashedPassword, email], (err) => {
      if (err) throw new Error('Database error during password update');

      const deleteOtpSql = 'DELETE FROM password_resets WHERE email = ?';
      connection.query(deleteOtpSql, [email], (err) => {
        if (err) throw new Error('Database error during OTP deletion');
        res.status(200).json({ message: 'Password has been updated successfully' });
      });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Resend OTP for Reset Password
app.post('/resent-otp/reset-password', async (req, res) => {
  try {
    const { email } = req.body;
    const userCheckSql = 'SELECT * FROM users WHERE email = ?';

    connection.query(userCheckSql, [email], (err, userResults) => {
      if (err) throw new Error('Database error during email check');
      if (userResults.length === 0) return res.status(400).json({ error: 'Email not found' });

      const otpCheckSql = 'SELECT * FROM password_resets WHERE email = ?';
      connection.query(otpCheckSql, [email], (err, otpResults) => {
        if (err) throw new Error('Database error during OTP check');
        if (otpResults.length === 0) return res.status(400).json({ error: 'No OTP record found for this email' });

        const otp = generateOtp();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        const updateOtpSql = 'UPDATE password_resets SET otp = ?, expires_at = ? WHERE email = ?';
        connection.query(updateOtpSql, [otp, expiresAt, email], (err) => {
          if (err) throw new Error('Database error during OTP update');
          sendOtpEmail(email, otp, (error) => {
            if (error) throw new Error('Error sending OTP email');
            res.status(200).json({ message: 'New OTP sent to email' });
          });
        });
      });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Get the user's IP address (optional)
    const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    const sql = 'SELECT id, password, google_id, failed_attempts, last_failed_attempt FROM users WHERE email = ?';
    connection.query(sql, [email], (err, results) => {
      if (err) throw new Error('Database error during login');
      if (results.length === 0) {
        return res.status(404).json({ message: 'No user found' });
      }

      const user = results[0];

      // Check if the user signed up with Google
      if (user.google_id !== null) {
        return res.status(400).json({ message: 'Please sign in using Google.' });
      }

      // Check if the password is missing
      if (user.password === null) {
        return res.status(400).json({ message: 'Email is associated with another sign-in method.' });
      }

      // If the user has exceeded failed login attempts, block them for 5 minutes
      if (user.failed_attempts >= 5 && user.last_failed_attempt) {
        const now = Date.now();
        const timeSinceLastAttempt = now - new Date(user.last_failed_attempt).getTime();
        if (timeSinceLastAttempt < 300000) { // 5 minutes
          return res.status(429).json({ message: 'Too many failed login attempts. Try again in 5 minutes.' });
        }
      }

      // Compare the entered password with the stored hashed password
      bcrypt.compare(password, user.password, (err, isMatch) => {
        if (err) throw new Error('Password comparison error');
        if (!isMatch) {
          // Increment failed attempts and update last_failed_attempt
          const updateFailSql = 'UPDATE users SET failed_attempts = failed_attempts + 1, last_failed_attempt = NOW() WHERE id = ?';
          connection.query(updateFailSql, [user.id], (err) => {
            if (err) console.error('Error logging failed login attempt:', err);
          });

          const remainingAttempts = 5 - (user.failed_attempts + 1); // +1 for current attempt
          return res.status(401).json({ message: `Email or Password is incorrect. You have ${remainingAttempts} attempts left.` });
        }

        // Reset failed attempts after a successful login
        const resetFailSql = 'UPDATE users SET failed_attempts = 0, last_login = NOW(), last_login_ip = ? WHERE id = ?';
        connection.query(resetFailSql, [ipAddress, user.id], (err) => {
          if (err) throw new Error('Error resetting failed attempts or updating login time.');

          // Generate JWT token
          const token = jwt.sign({ id: user.id }, JWT_SECRET);

          // Return successful login response with token and user data
          res.status(200).json({
            message: 'Authentication successful',
            token,
            user: {
              id: user.id,
              email,
              last_login: new Date(),
              last_login_ip: ipAddress
            }
          });
        });
      });
    });
  } catch (error) {
    console.error('Internal error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});



// Google Sign-In
app.post('/google-signin', async (req, res) => {
  try {
    const { googleId, email } = req.body;

    if (!googleId || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const checkGoogleIdSql = 'SELECT * FROM users WHERE google_id = ?';
    connection.query(checkGoogleIdSql, [googleId], (err, googleIdResults) => {
      if (err) throw new Error('Database error during Google ID check');

      if (googleIdResults.length > 0) {
        const user = googleIdResults[0];
        const updateSql = 'UPDATE users SET email = ? WHERE google_id = ?';
        connection.query(updateSql, [email, googleId], (err) => {
          if (err) throw new Error('Database error during user update');

          const token = jwt.sign({ id: user.id, email: user.email, google_id: user.google_id }, JWT_SECRET);
          return res.json({
            message: 'User information updated successfully',
            token,
            user: {
              id: user.id,
              email: user.email,
              google_id: user.google_id,
            },
          });
        });
      } else {
        const checkEmailSql = 'SELECT * FROM users WHERE email = ?';
        connection.query(checkEmailSql, [email], (err, emailResults) => {
          if (err) throw new Error('Database error during email check');
          if (emailResults.length > 0) return res.status(409).json({ error: 'Email already registered with another account' });

          const insertSql = 'INSERT INTO users (google_id, email) VALUES (?, ?)';
          connection.query(insertSql, [googleId, email], (err, result) => {
            if (err) throw new Error('Database error during user insertion');

            const newUserId = result.insertId;
            const newUserSql = 'SELECT * FROM users WHERE id = ?';
            connection.query(newUserSql, [newUserId], (err, newUserResults) => {
              if (err) throw new Error('Database error during new user fetch');

              const newUser = newUserResults[0];
              const token = jwt.sign({ id: newUser.id, email: newUser.email, google_id: newUser.google_id }, JWT_SECRET);

              return res.status(201).json({
                message: 'User registered and authenticated successfully',
                token,
                user: {
                  id: newUser.id,
                  email: newUser.email,
                  google_id: newUser.google_id,
                },
              });
            });
          });
        });
      }
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Record User Interaction (Like, Comment, etc.)
app.post('/interactions', async (req, res) => {
  try {
    const { user_id, post_id, action_type } = req.body;

    if (!user_id || !post_id || !action_type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const query = 'INSERT INTO user_interactions (user_id, post_id, action_type) VALUES (?, ?, ?)';
    const values = [user_id, post_id, action_type];

    connection.query(query, values, (err, results) => {
      if (err) throw new Error('Database error during interaction recording');
      res.status(201).json({ message: 'Interaction recorded successfully', interaction_id: results.insertId });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// View All Posts
app.get('/posts', async (req, res) => {
  try {
    connection.query('SELECT * FROM posts', (err, results) => {
      if (err) throw new Error('Database error during posts retrieval');
      res.json(results);
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// View a Single Post
app.get('/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    connection.query('SELECT * FROM posts WHERE post_id = ?', [id], (err, results) => {
      if (err) throw new Error('Database error during post retrieval');
      if (results.length === 0) return res.status(404).json({ error: 'Post not found' });
      res.json(results[0]);
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});



const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(403).json({ error: 'No token provided or incorrect format' });
  }

  // Extract the token after "Bearer "
  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET); // Use your JWT secret
    req.userId = decoded.id; // Extract the user ID from the token and attach it to the request
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};




// Create a Post
app.post('/posts', verifyToken, async (req, res) => {
  try {
    const { user_id, content, video_url, photo_url } = req.body;

    // Ensure the user is creating a post for their own account
    if (req.userId !== user_id) {
      return res.status(403).json({ error: 'You are not authorized to create a post for this user' });
    }

    const query = 'INSERT INTO posts (user_id, content, video_url, photo_url) VALUES (?, ?, ?, ?)';
    connection.query(query, [user_id, content, video_url, photo_url], (err, results) => {
      if (err) throw new Error('Database error during post creation');
      res.status(201).json({
        post_id: results.insertId,
        user_id,
        content,
        video_url,
        photo_url
      });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a Post
app.put('/posts/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { content, video_url, photo_url, user_id } = req.body;

    // Ensure the user is updating their own post
    if (req.userId !== user_id) {
      return res.status(403).json({ error: 'You are not authorized to update this post' });
    }

    const query = 'UPDATE posts SET content = ?, video_url = ?, photo_url = ?, updated_at = NOW() WHERE post_id = ? AND user_id = ?';
    connection.query(query, [content, video_url, photo_url, id, user_id], (err, results) => {
      if (err) throw new Error('Database error during post update');
      if (results.affectedRows === 0) return res.status(404).json({ error: 'Post not found or you are not the owner' });
      res.json({
        post_id: id,
        content,
        video_url,
        photo_url
      });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a Post
app.delete('/posts/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;

    // Ensure the user is deleting their own post
    if (req.userId !== user_id) {
      return res.status(403).json({ error: 'You are not authorized to delete this post' });
    }

    connection.query('DELETE FROM posts WHERE post_id = ? AND user_id = ?', [id, user_id], (err, results) => {
      if (err) throw new Error('Database error during post deletion');
      if (results.affectedRows === 0) return res.status(404).json({ error: 'Post not found or you are not the owner' });
      res.json({ message: 'Post deleted successfully' });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
