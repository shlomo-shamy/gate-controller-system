console.log('=== SERVER STARTUP DEBUG ===');
console.log('Node version:', process.version);
console.log('Platform:', process.platform);
console.log('Memory usage:', process.memoryUsage());
console.log('Environment variables set:', Object.keys(process.env).length);
console.log('PORT from environment:', process.env.PORT);
console.log('Current working directory:', process.cwd());

// Catch any unhandled errors
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

console.log('Starting main server code...');

const http = require('http');

console.log('Current working directory:', process.cwd());
console.log('Files in current directory:', require('fs').readdirSync('.'));

try {
  const packageJson = require('./package.json');
  console.log('Package.json found:', packageJson.dependencies);
} catch (error) {
  console.log('Package.json not found in current directory');
}

// Firebase Admin SDK (optional - falls back gracefully)
let admin, db, auth, firebaseInitialized = false;

try {
  console.log('Firebase environment check:');
  console.log('FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID ? 'SET' : 'MISSING');
  console.log('FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? 'SET (' + process.env.FIREBASE_PRIVATE_KEY.length + ' chars)' : 'MISSING');
  console.log('FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL ? 'SET' : 'MISSING');
  
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    admin = require('firebase-admin');
    
    const serviceAccount = {
      type: "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
    };

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    
    db = admin.firestore();
    auth = admin.auth();
    firebaseInitialized = true;
    console.log('Firebase initialized successfully');
  } else {
    console.log('Firebase environment variables missing - running in local mode');
  }
} catch (error) {
  console.log('Firebase initialization error:', error.message);
  console.log('Full error:', error);
}

console.log('🚀 Starting Railway server with ESP32 support, User Management, and Dashboard Login...');

// Let Railway assign the port - don't force 3000
const PORT = process.env.PORT || 3001;

console.log(`🔍 Full Environment check:`, {
  'process.env.PORT': process.env.PORT,
  'process.env.RAILWAY_ENVIRONMENT': process.env.RAILWAY_ENVIRONMENT,
  'Final PORT being used': PORT,
  'All env vars': Object.keys(process.env).filter(key => key.includes('RAILWAY'))
});

// Store connected devices
const connectedDevices = new Map();
const deviceCommands = new Map(); // Store commands for each device
const registeredUsers = new Map(); // Store registered users by deviceId
const deviceLogs = new Map(); // Store device logs
const deviceSchedules = new Map(); // Store device schedules

// Firebase-specific data stores
const authorizedUsers = new Map();
const manufacturingDevices = new Map();

// Demo data for testing - UPDATED: use phone numbers without + prefix
authorizedUsers.set('972501234567', {
  name: 'Demo Admin',
  email: 'demo@gatecontroller.com', 
  canActivateDevices: true
});

manufacturingDevices.set('ESP32_12345', {
  pin: '123456',
  activated: false
});

// Simple dashboard authentication - Default admin users
const DASHBOARD_USERS = new Map([
  ['admin@gatecontroller.com', { password: 'admin123', name: 'Administrator', userLevel: 3, phone: '0000000000' }],
  ['manager@gatecontroller.com', { password: 'gate2024', name: 'Gate Manager', userLevel: 1, phone: '0000000001' }]
]);

// Store active sessions (in production, use Redis or database)
const activeSessions = new Map();

function generateSessionToken() {
  return 'session_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function validateSession(sessionToken) {
  return activeSessions.has(sessionToken);
}

// PHONE VALIDATION HELPER FUNCTION - supports 10-14 digits
function validatePhoneNumber(phone) {
    console.log("Validating phone:", phone, "Type:", typeof phone);
    
    // Convert to string and remove any non-digit characters
    const cleanPhone = phone.toString().replace(/\D/g, '');
    console.log("Clean phone:", cleanPhone, "Length:", cleanPhone.length);
    
    // Check if it's between 10-14 digits
    const isValid = /^\d{10,14}$/.test(cleanPhone);
    console.log("Regex test result:", isValid);
    
    if (!isValid) {
        return {
            valid: false,
            message: `Phone number must be 10-14 digits. Received: "${cleanPhone}" (${cleanPhone.length} digits)`,
            cleanPhone: null
        };
    }
    
    return {
        valid: true,
        message: 'Valid phone number',
        cleanPhone: cleanPhone
    };
}

// Helper function to add device log
function addDeviceLog(deviceId, action, user, details = '') {
  if (!deviceLogs.has(deviceId)) {
    deviceLogs.set(deviceId, []);
  }
  
  const log = {
    timestamp: new Date().toISOString(),
    action: action,
    user: user,
    details: details,
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2)
  };
  
  const logs = deviceLogs.get(deviceId);
  logs.unshift(log); // Add to beginning
  
  // Keep only last 100 logs per device
  if (logs.length > 100) {
    logs.splice(100);
  }
  
  deviceLogs.set(deviceId, logs);
}

const server = http.createServer((req, res) => {
  console.log(`📡 ${req.method} ${req.url} - ${new Date().toISOString()}`);
  
  // Set CORS headers for all requests with UTF-8 support
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Helper function to read request body
  function readBody(callback) {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      try {
        const parsedBody = body ? JSON.parse(body) : {};
        callback(parsedBody);
      } catch (error) {
        console.error('❌ JSON Parse Error:', error);
        callback({});
      }
    });
  }

  // Helper function to get session token from cookie
  function getSessionFromCookie(cookieHeader) {
    if (!cookieHeader) return null;
    const sessionMatch = cookieHeader.match(/session=([^;]+)/);
    return sessionMatch ? sessionMatch[1] : null;
  }

// UPDATED DEVICE ACTIVATION ENDPOINT - add phone validation
if (req.url === '/api/device/activate' && req.method === 'POST') {
  readBody(async (data) => {
    const { serial, pin, activating_user } = data;
    
    // ADDED: Clean the activating_user phone number
    const phoneValidation = validatePhoneNumber(activating_user);
    if (!phoneValidation.valid) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: phoneValidation.message }));
      return;
    }
    
    const cleanActivatingUser = phoneValidation.cleanPhone;
    
    // Validate device exists
    const device = manufacturingDevices.get(serial);
    if (!device || device.pin !== pin) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: 'Invalid device credentials' }));
      return;
    }
    
    // UPDATED: Validate user authorized with cleaned phone
    const user = authorizedUsers.get(cleanActivatingUser);
    if (!user || !user.canActivateDevices) {
      res.writeHead(403);
      res.end(JSON.stringify({ success: false, error: 'User not authorized' }));
      return;
    }
    
    // Mark device as activated locally
    device.activated = true;
    
    // Add to local registered users
    if (!registeredUsers.has(serial)) {
      registeredUsers.set(serial, []);
    }
    registeredUsers.get(serial).push({
      email: user.email,
      phone: cleanActivatingUser, // UPDATED: use cleaned phone
      name: user.name,
      relayMask: 15,
      userLevel: 2
    });
    
    // CREATE FIREBASE DOCUMENTS
    if (firebaseInitialized) {
      try {
        // Create gate document
        const gateData = {
          serial: serial,
          name: `Gate ${serial}`,
          location: 'Location not specified',
          timezone: 'Asia/Jerusalem',
          activatedBy: cleanActivatingUser, // UPDATED: use cleaned phone
          activationDate: admin.firestore.FieldValue.serverTimestamp(),
          admins: [cleanActivatingUser], // UPDATED: use cleaned phone
          users: {
            [cleanActivatingUser]: { // UPDATED: use cleaned phone
              name: user.name,
              relayMask: 15,
              role: 'admin',
              addedBy: 'system',
              addedDate: admin.firestore.FieldValue.serverTimestamp()
            }
          }
        };
        
        await db.collection('gates').doc(serial).set(gateData);
        console.log('Firebase gate document created:', serial);
        
        // Create user permissions document
        await db.collection('userPermissions').doc(cleanActivatingUser).set({ // UPDATED: use cleaned phone
          gates: {
            [serial]: {
              name: gateData.name,
              relayMask: 15,
              role: 'admin',
              addedBy: 'system',
              addedDate: admin.firestore.FieldValue.serverTimestamp()
            }
          }
        }, { merge: true });
        
        console.log('Firebase user permissions created:', cleanActivatingUser);
        
      } catch (firebaseError) {
        console.error('Firebase write error:', firebaseError);
      }
    }
    
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      message: 'Device activated successfully',
      firebase_status: firebaseInitialized ? 'connected' : 'local_mode'
    }));
  });
  return;
}
  
  // Dashboard login endpoint
  if (req.url === '/dashboard/login' && req.method === 'POST') {
    readBody((data) => {
      const { email, password } = data;
      const user = DASHBOARD_USERS.get(email);
      
      if (user && user.password === password) {
        const sessionToken = generateSessionToken();
        activeSessions.set(sessionToken, {
          email: email,
          name: user.name,
          userLevel: user.userLevel,
          phone: user.phone,
          loginTime: new Date().toISOString()
        });
        
        console.log(`🔐 Dashboard login successful: ${email}`);
        
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': `session=${sessionToken}; HttpOnly; Path=/; Max-Age=86400` // 24 hours
        });
        res.end(JSON.stringify({
          success: true,
          message: 'Login successful',
          user: { email, name: user.name, userLevel: user.userLevel }
        }));
      } else {
        console.log(`🔐 Dashboard login failed: ${email}`);
        res.writeHead(401);
        res.end(JSON.stringify({
          success: false,
          message: 'Invalid email or password'
        }));
      }
    });
    return;
  }

  // Dashboard logout endpoint
  if (req.url === '/dashboard/logout' && req.method === 'POST') {
    const sessionToken = getSessionFromCookie(req.headers.cookie);
    if (sessionToken && activeSessions.has(sessionToken)) {
      const session = activeSessions.get(sessionToken);
      activeSessions.delete(sessionToken);
      console.log(`🔐 Dashboard logout: ${session.email}`);
    }
    
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'session=; HttpOnly; Path=/; Max-Age=0'
    });
    res.end(JSON.stringify({ success: true, message: 'Logged out' }));
    return;
  }

  // ESP32 Heartbeat endpoint (no auth required for device communication)
  if (req.url === '/api/device/heartbeat' && req.method === 'POST') {
    console.log(`💓 Heartbeat from ESP32: ${req.method} ${req.url}`);
    
    readBody((data) => {
      const deviceId = data.deviceId || 'unknown';
      const timestamp = new Date().toISOString();
      
      // Store/update device info
      connectedDevices.set(deviceId, {
        lastHeartbeat: timestamp,
        status: data.status || 'online',
        signalStrength: data.signalStrength || 0,
        batteryLevel: data.batteryLevel || 0,
        firmwareVersion: data.firmwareVersion || '1.0.0',
        uptime: data.uptime || 0,
        freeHeap: data.freeHeap || 0,
        connectionType: data.connectionType || 'wifi'
      });
      
      // Add log entry
      addDeviceLog(deviceId, 'heartbeat', 'system', `Signal: ${data.signalStrength}dBm, Battery: ${data.batteryLevel}%`);
      
      console.log(`💓 Device ${deviceId} heartbeat received:`, connectedDevices.get(deviceId));
      
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        message: "Heartbeat received",
        timestamp: timestamp,
        deviceId: deviceId
      }));
    });
    return;
  }

  // ESP32 Command check endpoint - GET /api/device/{deviceId}/commands (no auth required)
  if (req.url.startsWith('/api/device/') && req.url.endsWith('/commands') && req.method === 'GET') {
    const urlParts = req.url.split('/');
    const deviceId = urlParts[3];
    
    console.log(`📥 Command check from ESP32 device: ${deviceId}`);
    
    const deviceCommandQueue = deviceCommands.get(deviceId) || [];
    deviceCommands.set(deviceId, []);
    
    console.log(`📋 Sending ${deviceCommandQueue.length} commands to device ${deviceId}`);
    
    res.writeHead(200);
    res.end(JSON.stringify(deviceCommandQueue));
    return;
  }

  // ESP32 Authentication endpoint (no auth required)
  if (req.url === '/api/device/auth' && req.method === 'POST') {
    console.log(`🔐 Auth request from ESP32: ${req.method} ${req.url}`);
    
    readBody((data) => {
      const deviceId = data.deviceId || 'unknown';
      const deviceType = data.deviceType || 'unknown';
      const firmwareVersion = data.firmwareVersion || '1.0.0';
      
      console.log(`🔐 Authenticating device: ${deviceId} (${deviceType}) v${firmwareVersion}`);
      
      // Add log entry
      addDeviceLog(deviceId, 'authentication', 'system', `Device type: ${deviceType}, Firmware: ${firmwareVersion}`);
      
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        token: "device_token_" + deviceId + "_" + Date.now(),
        message: "Device authenticated",
        deviceId: deviceId
      }));
    });
    return;
  }

  // Protected dashboard endpoints - require login
  function requireAuth(callback) {
    const sessionToken = getSessionFromCookie(req.headers.cookie);
    if (!sessionToken || !validateSession(sessionToken)) {
      // Return login page for dashboard access
      if (req.url === '/dashboard' || req.url === '/') {
        const loginHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>🔐 Gate Controller Login</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0; 
            padding: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .login-container { 
            background: white; 
            padding: 40px; 
            border-radius: 15px; 
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            max-width: 400px;
            width: 90%;
        }
        .login-header { 
            text-align: center; 
            margin-bottom: 30px;
            color: #333;
        }
        .login-header h1 {
            margin: 0;
            font-size: 2em;
            color: #667eea;
        }
        .form-group { margin-bottom: 20px; }
        label { 
            display: block; 
            margin-bottom: 5px; 
            font-weight: bold;
            color: #555;
        }
        input { 
            width: 100%; 
            padding: 12px; 
            border: 2px solid #ddd; 
            border-radius: 8px; 
            font-size: 16px;
            box-sizing: border-box;
        }
        input:focus {
            outline: none;
            border-color: #667eea;
        }
        button { 
            width: 100%; 
            padding: 12px; 
            background: #667eea; 
            color: white; 
            border: none; 
            border-radius: 8px; 
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: background 0.3s;
        }
        button:hover { background: #5a6fd8; }
        .error { 
            color: #dc3545; 
            margin-top: 10px; 
            text-align: center;
            font-weight: bold;
        }
        .demo-info {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            margin-top: 20px;
            font-size: 14px;
            border-left: 4px solid #17a2b8;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="login-header">
            <h1>🚪 Gate Controller</h1>
            <p>Dashboard Login</p>
        </div>
        
        <form id="loginForm">
            <div class="form-group">
                <label for="email">Email:</label>
                <input type="email" id="email" name="email" required>
            </div>
            
            <div class="form-group">
                <label for="password">Password:</label>
                <input type="password" id="password" name="password" required>
            </div>
            
            <button type="submit">🔐 Login</button>
            
            <div id="error" class="error"></div>
        </form>
        
        <div class="demo-info">
            <strong>Demo Credentials:</strong><br>
            Email: <code>admin@gatecontroller.com</code> / Password: <code>admin123</code><br>
            Email: <code>manager@gatecontroller.com</code> / Password: <code>gate2024</code>
        </div>
    </div>

    <script>
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const errorDiv = document.getElementById('error');
            
            try {
                const response = await fetch('/dashboard/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                    body: JSON.stringify({ email, password })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    window.location.href = '/dashboard';
                } else {
                    errorDiv.textContent = data.message || 'Login failed';
                }
            } catch (error) {
                errorDiv.textContent = 'Connection error: ' + error.message;
            }
        });
    </script>
</body>
</html>`;
        
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(loginHtml);
        return;
      } else {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Authentication required' }));
        return;
      }
    }
    
    const session = activeSessions.get(sessionToken);
    callback(session);
  }

  // Get device users endpoint
  if (req.url.startsWith('/api/device/') && req.url.endsWith('/users') && req.method === 'GET') {
    requireAuth((session) => {
      const urlParts = req.url.split('/');
      const deviceId = urlParts[3];
      
      const users = registeredUsers.get(deviceId) || [];
      
      res.writeHead(200);
      res.end(JSON.stringify(users));
    });
    return;
  }

  // Get device logs endpoint
  if (req.url.startsWith('/api/device/') && req.url.endsWith('/logs') && req.method === 'GET') {
    requireAuth((session) => {
      const urlParts = req.url.split('/');
      const deviceId = urlParts[3];
      
      const logs = deviceLogs.get(deviceId) || [];
      
      res.writeHead(200);
      res.end(JSON.stringify(logs));
    });
    return;
  }

  // FIREBASE SYNC ENDPOINT - sync all local users to Firebase
  if (req.url === '/api/firebase/sync' && req.method === 'POST') {
    requireAuth((session) => {
      if (session.userLevel < 2) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'Admin access required' }));
        return;
      }
      
      if (!firebaseInitialized) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Firebase not initialized' }));
        return;
      }
      
      readBody(async (data) => {
        try {
          let syncedDevices = 0;
          let syncedUsers = 0;
          
          // Sync all registered users to Firebase
          for (const [deviceId, users] of registeredUsers.entries()) {
            // Check if gate document exists, create if not
            const gateRef = db.collection('gates').doc(deviceId);
            const gateDoc = await gateRef.get();
            
            const gateUsers = {};
            let gateAdmins = [];
            
            // Prepare users data
            for (const user of users) {
              gateUsers[user.phone] = {
                name: user.name,
                email: user.email,
                relayMask: user.relayMask,
                userLevel: user.userLevel,
                role: user.userLevel >= 2 ? 'admin' : (user.userLevel >= 1 ? 'manager' : 'user'),
                addedBy: user.registeredBy || 'system',
                addedDate: admin.firestore.FieldValue.serverTimestamp()
              };
              
              // Collect admin phone numbers
              if (user.userLevel >= 2) {
                gateAdmins.push(user.phone);
              }
              
              // Update user permissions
              await db.collection('userPermissions').doc(user.phone).set({
                gates: {
                  [deviceId]: {
                    name: `Gate ${deviceId}`,
                    relayMask: user.relayMask,
                    role: user.userLevel >= 2 ? 'admin' : (user.userLevel >= 1 ? 'manager' : 'user'),
                    addedBy: user.registeredBy || 'system',
                    addedDate: admin.firestore.FieldValue.serverTimestamp()
                  }
                }
              }, { merge: true });
              
              syncedUsers++;
            }
            
            if (!gateDoc.exists) {
              // Create new gate document
              const firstAdmin = users.find(u => u.userLevel >= 2);
              await gateRef.set({
                serial: deviceId,
                name: `Gate ${deviceId}`,
                location: 'Location not specified',
                timezone: 'Asia/Jerusalem',
                activatedBy: firstAdmin ? firstAdmin.phone : users[0]?.phone || 'unknown',
                activationDate: admin.firestore.FieldValue.serverTimestamp(),
                admins: gateAdmins.length > 0 ? gateAdmins : [users[0]?.phone || 'unknown'],
                users: gateUsers
              });
            } else {
              // Update existing gate document
              await gateRef.update({
                users: gateUsers,
                admins: gateAdmins.length > 0 ? gateAdmins : admin.firestore.FieldValue.arrayUnion()
              });
            }
            
            syncedDevices++;
          }
          
          res.writeHead(200);
          res.end(JSON.stringify({
            success: true,
            message: 'Firebase sync completed',
            syncedDevices: syncedDevices,
            syncedUsers: syncedUsers
          }));
          
        } catch (error) {
          console.error('Firebase sync error:', error);
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Firebase sync failed: ' + error.message }));
        }
      });
    });
    return;
  }

  // DELETE USER ENDPOINT - require auth
  if (req.url.includes('/delete-user') && req.method === 'DELETE') {
    requireAuth((session) => {
      const urlParts = req.url.split('/');
      const deviceId = urlParts[3];
      
      console.log(`🗑️ User deletion for device: ${deviceId} by ${session.email}`);
      
      readBody(async (data) => {
        const { phone, email } = data;
        
        if (!phone && !email) {
          res.writeHead(400);
          res.end(JSON.stringify({
            success: false,
            error: 'Phone or email required for deletion'
          }));
          return;
        }
        
        // Find and remove user from local storage
        const users = registeredUsers.get(deviceId) || [];
        const userIndex = users.findIndex(u => 
          (phone && u.phone === phone) || (email && u.email === email)
        );
        
        if (userIndex === -1) {
          res.writeHead(404);
          res.end(JSON.stringify({
            success: false,
            error: 'User not found'
          }));
          return;
        }
        
        const deletedUser = users[userIndex];
        users.splice(userIndex, 1);
        registeredUsers.set(deviceId, users);
        
        // Remove from dashboard users if exists
        if (deletedUser.canLogin && deletedUser.email) {
          DASHBOARD_USERS.delete(deletedUser.email);
        }
        
        // Send delete command to ESP32
        const deleteCommand = {
          id: 'del_' + Date.now(),
          action: 'delete_user',
          phone: deletedUser.phone,
          email: deletedUser.email,
          timestamp: Date.now(),
          deletedBy: session.email
        };
        
        if (!deviceCommands.has(deviceId)) {
          deviceCommands.set(deviceId, []);
        }
        deviceCommands.get(deviceId).push(deleteCommand);
        
        // FIREBASE: Remove user from Firebase if connected
        if (firebaseInitialized) {
          try {
            // Remove user from gate document
            await db.collection('gates').doc(deviceId).update({
              [`users.${deletedUser.phone}`]: admin.firestore.FieldValue.delete()
            });
            
            // Remove gate from user permissions or delete document if no gates left
            const userPermRef = db.collection('userPermissions').doc(deletedUser.phone);
            const userPermDoc = await userPermRef.get();
            
            if (userPermDoc.exists) {
              const userData = userPermDoc.data();
              if (userData.gates && Object.keys(userData.gates).length === 1 && userData.gates[deviceId]) {
                // Delete entire document if this was the only gate
                await userPermRef.delete();
              } else {
// Remove just this gate
                await userPermRef.update({
                  [`gates.${deviceId}`]: admin.firestore.FieldValue.delete()
                });
              }
            }
            
            console.log(`Firebase: User ${deletedUser.phone} removed from gate ${deviceId}`);
            
          } catch (firebaseError) {
            console.error('Firebase user deletion error:', firebaseError);
          }
        }
        
        // Add log entry
        addDeviceLog(deviceId, 'user_deleted', session.email, `User: ${deletedUser.name} (${deletedUser.email}/${deletedUser.phone})`);
        
        console.log(`User deleted from device ${deviceId}:`, deletedUser);
        
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          message: "User deleted successfully",
          deletedUser: {
            name: deletedUser.name,
            email: deletedUser.email,
            phone: deletedUser.phone
          },
          deviceId: deviceId,
          firebase_status: firebaseInitialized ? 'removed' : 'local_only'
        }));
      });
    });
    return;
  }

  // UPDATED USER REGISTRATION ENDPOINT - add phone validation
  if (req.url.includes('/register-user') && req.method === 'POST') {
    requireAuth((session) => {
      const urlParts = req.url.split('/');
      const deviceId = urlParts[3];
      
      console.log(`User registration for device: ${deviceId} by ${session.email}`);
      
      readBody(async (data) => {
        console.log("Registration data received:", data);
        
        // Validate phone number
        const phoneValidation = validatePhoneNumber(data.phone);
        console.log("Phone validation result:", phoneValidation);
        
        if (!phoneValidation.valid) {
          console.error("Phone validation failed:", phoneValidation.message);
          res.writeHead(400);
          res.end(JSON.stringify({
            success: false,
            error: phoneValidation.message
          }));
          return;
        }
        
        // Use the cleaned phone number
        const cleanPhone = phoneValidation.cleanPhone;
        console.log("Using cleaned phone:", cleanPhone);
        
        // Store user in registered users
        if (!registeredUsers.has(deviceId)) {
          registeredUsers.set(deviceId, []);
        }
        
        const users = registeredUsers.get(deviceId);
        
        // Check if user already exists (by email or cleaned phone)
        const existingUserIndex = users.findIndex(u => u.email === data.email || u.phone === cleanPhone);
        if (existingUserIndex >= 0) {
          users[existingUserIndex] = {
            email: data.email,
            phone: cleanPhone,
            name: data.name || 'New User',
            password: data.password || 'defaultpass123',
            relayMask: data.relayMask || 1,
            userLevel: data.userLevel || 0,
            canLogin: data.canLogin || false,
            registeredBy: session.email,
            registeredAt: users[existingUserIndex].registeredAt,
            lastUpdated: new Date().toISOString()
          };
        } else {
          users.push({
            email: data.email,
            phone: cleanPhone,
            name: data.name || 'New User',
            password: data.password || 'defaultpass123',
            relayMask: data.relayMask || 1,
            userLevel: data.userLevel || 0,
            canLogin: data.canLogin || false,
            registeredBy: session.email,
            registeredAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
          });
          
          // Add to dashboard users if they have login permission
          if (data.canLogin && data.email && data.password) {
            DASHBOARD_USERS.set(data.email, {
              password: data.password,
              name: data.name || 'New User',
              userLevel: data.userLevel || 0,
              phone: cleanPhone
            });
          }
        }
        
        registeredUsers.set(deviceId, users);
        
        const registrationCommand = {
          id: 'reg_' + Date.now(),
          action: 'register_user',
          phone: cleanPhone,
          email: data.email,
          name: data.name || 'New User',
          relayMask: data.relayMask || 1,
          userLevel: data.userLevel || 0,
          timestamp: Date.now(),
          registeredBy: session.email
        };
        
        if (!deviceCommands.has(deviceId)) {
          deviceCommands.set(deviceId, []);
        }
        deviceCommands.get(deviceId).push(registrationCommand);
        
        // FIREBASE INTEGRATION: Add user to Firebase if connected
        if (firebaseInitialized) {
          try {
            // Check if gate document exists, create if not
            const gateRef = db.collection('gates').doc(deviceId);
            const gateDoc = await gateRef.get();
            
            if (!gateDoc.exists) {
              // Create new gate document
              await gateRef.set({
                serial: deviceId,
                name: `Gate ${deviceId}`,
                location: 'Location not specified',
                timezone: 'Asia/Jerusalem',
                activatedBy: cleanPhone,
                activationDate: admin.firestore.FieldValue.serverTimestamp(),
                admins: [cleanPhone],
                users: {
                  [cleanPhone]: {
                    name: data.name || 'New User',
                    email: data.email,
                    relayMask: data.relayMask || 1,
                    userLevel: data.userLevel || 0,
                    role: data.userLevel >= 2 ? 'admin' : (data.userLevel >= 1 ? 'manager' : 'user'),
                    addedBy: session.email,
                    addedDate: admin.firestore.FieldValue.serverTimestamp()
                  }
                }
              });
            } else {
              // Update existing gate document
              await gateRef.update({
                [`users.${cleanPhone}`]: {
                  name: data.name || 'New User',
                  email: data.email,
                  relayMask: data.relayMask || 1,
                  userLevel: data.userLevel || 0,
                  role: data.userLevel >= 2 ? 'admin' : (data.userLevel >= 1 ? 'manager' : 'user'),
                  addedBy: session.email,
                  addedDate: admin.firestore.FieldValue.serverTimestamp()
                }
              });
            }
            
            // Update or create user permissions document
            await db.collection('userPermissions').doc(cleanPhone).set({
              gates: {
                [deviceId]: {
                  name: `Gate ${deviceId}`,
                  relayMask: data.relayMask || 1,
                  role: data.userLevel >= 2 ? 'admin' : (data.userLevel >= 1 ? 'manager' : 'user'),
                  addedBy: session.email,
                  addedDate: admin.firestore.FieldValue.serverTimestamp()
                }
              }
            }, { merge: true });
            
            console.log(`Firebase: User ${cleanPhone} added to gate ${deviceId}`);
            
          } catch (firebaseError) {
            console.error('Firebase user registration error:', firebaseError);
          }
        }
        
        // Add log entry with cleaned phone
        addDeviceLog(deviceId, 'user_registered', session.email, `User: ${data.name} (${data.email}/${cleanPhone})`);
        
        console.log(`Registration successful for device ${deviceId}:`, registrationCommand);
        
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          message: "User registration queued",
          email: data.email,
          phone: cleanPhone,
          deviceId: deviceId,
          firebase_status: firebaseInitialized ? 'synced' : 'local_only'
        }));
      });
    });
    return;
  }

  // Command injection endpoint - require auth
  if (req.url.includes('/send-command') && req.method === 'POST') {
    requireAuth((session) => {
      const urlParts = req.url.split('/');
      const deviceId = urlParts[3];
      
      console.log(`Command sent to ESP32 device: ${deviceId} by ${session.email}`);
      
      readBody((data) => {
        const command = {
          id: data.id || 'cmd_' + Date.now(),
          action: data.action || 'relay_activate',
          relay: data.relay || 1,
          duration: data.duration || 2000,
          user: data.user || session.email,
          user_id: data.user_id || null,
          timestamp: Date.now(),
          sentBy: session.email
        };
        
        if (!deviceCommands.has(deviceId)) {
          deviceCommands.set(deviceId, []);
        }
        deviceCommands.get(deviceId).push(command);
        
        // Add log entry
        addDeviceLog(deviceId, 'command_sent', session.email, `Action: ${command.action}, Relay: ${command.relay}, User ID: ${command.user_id}`);
        
        console.log(`Command queued for device ${deviceId}:`, command);
        
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          message: "Command queued for device",
          commandId: command.id,
          deviceId: deviceId,
          timestamp: new Date().toISOString()
        }));
      });
    });
    return;
  }

  // Protected dashboard - require auth
  if (req.url === '/dashboard') {
    requireAuth((session) => {
      try {
      const dashboardHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Gate Controller Dashboard</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif; 
            margin: 0; 
            background: #f5f5f5; 
            font-size: 14px;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { 
            background: white; 
            padding: 20px; 
            margin-bottom: 20px; 
            border-radius: 8px; 
            box-shadow: 0 2px 4px rgba(0,0,0,0.1); 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
        }
        .user-info { color: #666; }
        .logout { background: #dc3545; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
        .card { 
            background: white; 
            padding: 20px; 
            margin-bottom: 20px; 
            border-radius: 8px; 
            box-shadow: 0 2px 4px rgba(0,0,0,0.1); 
        }
        .device { 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            border-left: 4px solid #28a745; 
            padding: 15px 20px;
        }
        .device.offline { border-left-color: #dc3545; }
        .device-info h3 { margin: 0 0 5px 0; color: #333; }
        .device-status { font-size: 12px; color: #666; }
        .device-actions { display: flex; gap: 10px; align-items: center; }
        .control-btn { 
            padding: 8px 15px; 
            border: none; 
            border-radius: 4px; 
            cursor: pointer; 
            font-weight: bold; 
            font-size: 12px;
        }
        .open { background: #28a745; color: white; }
        .stop { background: #ffc107; color: black; }
        .close { background: #dc3545; color: white; }
        .partial { background: #6f42c1; color: white; }
        h1 { color: #333; margin: 0; }
        .refresh { background: #007bff; color: white; margin-bottom: 20px; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div>
                <h1>Gate Controller Dashboard</h1>
                <div class="user-info">
                    Logged in as: <strong>${session.name}</strong> (${session.email})
                </div>
            </div>
            <button class="logout" onclick="logout()">Logout</button>
        </div>
        
        <button class="refresh" onclick="location.reload()">Refresh</button>
        <div id="devices"></div>
    </div>

    <script>
        const devices = ${JSON.stringify(Array.from(connectedDevices.entries()))};
        const registeredUsers = ${JSON.stringify(Array.from(registeredUsers.entries()))};
        
        async function logout() {
            try {
                await fetch('/dashboard/logout', { method: 'POST' });
                window.location.href = '/dashboard';
            } catch (error) {
                alert('Logout error: ' + error.message);
            }
        }
        
        function sendCommand(deviceId, relay, action) {
            const userId = prompt("Enter your registered phone number (10-14 digits, numbers only):");
            if (!userId) return;
            
            const cleanUserId = userId.replace(/\\D/g, '');
            
            if (!/^\\d{10,14}$/.test(cleanUserId)) {
                alert('Please enter a valid phone number (10-14 digits, numbers only)\\n\\nExamples:\\n• US: 1234567890\\n• International: 972501234567');
                return;
            }
            
            if (!confirm('Send ' + action + ' command with user ID: ' + cleanUserId + '?')) {
                return;
            }
            
            fetch('/api/device/' + deviceId + '/send-command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({
                    id: 'web_' + Date.now(),
                    action: 'relay_activate',
                    relay: relay,
                    duration: 2000,
                    user: 'dashboard',
                    user_id: cleanUserId
                })
            })
            .then(r => r.json())
            .then(d => {
                if (d.success) {
                    alert('Command sent: ' + action);
                } else {
                    alert('Command failed');
                }
            })
            .catch(e => alert('Error: ' + e.message));
        }

        function renderDevices() {
            const container = document.getElementById('devices');
            if (devices.length === 0) {
                container.innerHTML = '<div class="card"><p>No devices connected yet. Waiting for ESP32 heartbeat...</p></div>';
                return;
            }
            
            container.innerHTML = devices.map(([deviceId, info]) => {
                const isOnline = (Date.now() - new Date(info.lastHeartbeat).getTime()) < 60000;
                const deviceUsers = registeredUsers.find(([id]) => id === deviceId);
                const userCount = deviceUsers ? deviceUsers[1].length : 0;
                
                return \\`
                    <div class="card device \\${isOnline ? '' : 'offline'}">
                        <div class="device-info">
                            <h3>\\${deviceId} \\${isOnline ? '🟢' : '🔴'}</h3>
                            <div class="device-status">
                                Signal: \\${info.signalStrength}dBm | 
                                Battery: \\${info.batteryLevel}% | 
                                Uptime: \\${Math.floor(info.uptime / 1000)}s |
                                Users: \\${userCount}<br>
                                Last Heartbeat: \\${new Date(info.lastHeartbeat).toLocaleTimeString()}
                            </div>
                        </div>
                        
                        <div class="device-actions">
                            <button class="control-btn open" onclick="sendCommand('\\${deviceId}', 1, 'OPEN')">OPEN</button>
                            <button class="control-btn stop" onclick="sendCommand('\\${deviceId}', 2, 'STOP')">STOP</button>
                            <button class="control-btn close" onclick="sendCommand('\\${deviceId}', 3, 'CLOSE')">CLOSE</button>
                            <button class="control-btn partial" onclick="sendCommand('\\${deviceId}', 4, 'PARTIAL')">PARTIAL</button>
                        </div>
                    </div>
                \\`;
            }).join('');
        }
        
        renderDevices();
    </script>
</body>
</html>
      `;
            
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(dashboardHtml);
            
        } catch (error) {
            console.error('Dashboard error:', error);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Dashboard error: ' + error.message);
        }
    });
    return;
}

  // Health check endpoint (public)
  if (req.url === '/health') {
    const responseData = {
      message: 'Railway server is working perfectly!',
      timestamp: new Date().toISOString(),
      url: req.url,
      method: req.method,
      port: PORT,
      connectedDevices: connectedDevices.size,
      activeSessions: activeSessions.size,
      server_info: {
        actual_port: PORT,
        railway_env: process.env.RAILWAY_ENVIRONMENT || 'not_set',
        node_env: process.env.NODE_ENV || 'not_set'
      }
    };
    
    res.writeHead(200);
    res.end(JSON.stringify(responseData, null, 2));
    return;
  }

  // API endpoints list (public)
  if (req.url === '/api' || req.url === '/api/') {
    const responseData = {
      message: 'Gate Controller API with User Management and Authentication',
      timestamp: new Date().toISOString(),
      connectedDevices: connectedDevices.size,
      activeSessions: activeSessions.size,
      endpoints: [
        'GET /',
        'GET /dashboard (requires login)',
        'POST /dashboard/login',
        'POST /dashboard/logout', 
        'GET /health', 
        'POST /api/device/heartbeat',
        'GET /api/device/{deviceId}/commands',
        'POST /api/device/auth',
        'POST /api/device/activate',
        'POST /api/device/{deviceId}/send-command (requires login)',
        'POST /api/device/{deviceId}/register-user (requires login)',
        'DELETE /api/device/{deviceId}/delete-user (requires login)',
        'GET /api/device/{deviceId}/users (requires login)',
        'GET /api/device/{deviceId}/logs (requires login)',
        'POST /api/firebase/sync (requires admin)'
      ],
      devices: Array.from(connectedDevices.keys())
    };
    
    res.writeHead(200);
    res.end(JSON.stringify(responseData, null, 2));
    return;
  }

  // Root redirect to dashboard
  if (req.url === '/') {
    res.writeHead(302, { 'Location': '/dashboard' });
    res.end();
    return;
  }

  // Default response for other endpoints
  const responseData = {
    message: 'Railway Gate Controller Server with Authentication',
    timestamp: new Date().toISOString(),
    url: req.url,
    method: req.method,
    port: PORT,
    help: 'Visit /dashboard for the control interface or /api for API info'
  };
  
  res.writeHead(404);
  res.end(JSON.stringify(responseData, null, 2));
});

server.on('error', (err) => {
  console.error('Server error:', err);
  console.error('Error details:', {
    code: err.code,
    message: err.message,
    port: PORT
  });
});

server.on('listening', () => {
  const addr = server.address();
  console.log('Server successfully listening with Authentication!');
  console.log(`Port: ${addr.port}`);
  console.log(`Address: ${addr.address}`);
  console.log(`Railway should now be able to route traffic`);
  console.log(`Dashboard: https://gate-controller-system-production.up.railway.app/dashboard`);
  console.log(`Demo Login: admin@gatecontroller.com/admin123 or manager@gatecontroller.com/gate2024`);
});

// Start server
server.listen(PORT, '0.0.0.0', (err) => {
  if (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
  console.log(`Server started on ${PORT} with Authentication`);
});

// Health check endpoint logging
setInterval(() => {
  console.log(`Server heartbeat - Port: ${PORT} - Devices: ${connectedDevices.size} - Sessions: ${activeSessions.size} - ${new Date().toISOString()}`);
  
  // Clean up old devices (offline for more than 5 minutes)
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  for (const [deviceId, info] of connectedDevices.entries()) {
    if (new Date(info.lastHeartbeat).getTime() < fiveMinutesAgo) {
      console.log(`Removing offline device: ${deviceId}`);
      connectedDevices.delete(deviceId);
      deviceCommands.delete(deviceId);
      deviceLogs.delete(deviceId);
      registeredUsers.delete(deviceId);
      deviceSchedules.delete(deviceId);
    }
  }
  
  // Clean up old sessions (older than 24 hours)
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  for (const [sessionToken, session] of activeSessions.entries()) {
    if (new Date(session.loginTime).getTime() < oneDayAgo) {
      console.log(`Removing expired session: ${session.email}`);
      activeSessions.delete(sessionToken);
    }
  }
}, 30000);
