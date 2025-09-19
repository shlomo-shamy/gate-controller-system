// User management functions
        function editUser(email) {
            if (!currentDeviceId) return;
            
            const users = registeredUsers.find(([id]) => id === currentDeviceId);
            if (!users) return;
            
            const user = users[1].find(u => u.email === email);
            if (!user) return;
            
            editingUser = { ...user, originalEmail: email, deviceId: currentDeviceId };
            
            // Populate edit form
            document.getElementById('editEmail').value = user.email;
            document.getElementById('editPhone').value = user.phone;
            document.getElementById('editName').value = user.name;
            document.getElementById('editPassword').value = user.password || '';
            document.getElementById('editUserLevel').value = user.userLevel;
            document.getElementById('editCanLogin').checked = user.canLogin;
            
            // Set relay permissions
            document.getElementById('editRelay1').checked = (user.relayMask & 1) !== 0;
            document.getElementById('editRelay2').checked = (user.relayMask & 2) !== 0;
            document.getElementById('editRelay3').checked = (user.relayMask & 4) !== 0;
            document.getElementById('editRelay4').checked = (user.relayMask & 8) !== 0;
            
            document.getElementById('editUserModal').style.display = 'block';
        }
        
        function closeEditUserModal() {
            document.getElementById('editUserModal').style.display = 'none';
            editingUser = null;
        }
        
        async function updateUser() {
            if (!editingUser) return;
            
            const email = document.getElementById('editEmail').value;
            const phone = document.getElementById('editPhone').value;
            const name = document.getElementById('editName').value;
            const password = document.getElementById('editPassword').value;
            const userLevel = parseInt(document.getElementById('editUserLevel').value);
            const canLogin = document.getElementById('editCanLogin').checked;
            
            let relayMask = 0;
            if (document.getElementById('editRelay1').checked) relayMask |= 1;
            if (document.getElementById('editRelay2').checked) relayMask |= 2;
            if (document.getElementById('editRelay3').checked) relayMask |= 4;
            if (document.getElementById('editRelay4').checked) relayMask |= 8;
            
            if (!email || !phone || !name) {
                alert('Please fill in email, phone, and name fields');
                return;
            }
            
            if (!/^\\d{10}$/.test(phone)) {
                alert('Please enter a valid 10-digit phone number');
                return;
            }
            
            if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
                alert('Please enter a valid email address');
                return;
            }
            
            if (canLogin && (!password || password.length < 6)) {
                alert('Password must be at least 6 characters if login is allowed');
                return;
            }
            
            try {
                const response = await fetch('/api/device/' + editingUser.deviceId + '/update-user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                    body: JSON.stringify({
                        originalEmail: editingUser.originalEmail,
                        email: email,
                        phone: parseInt(phone),
                        name: name,
                        password: password,
                        relayMask: relayMask,
                        userLevel: userLevel,
                        canLogin: canLogin
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('✅ User updated successfully: ' + name);
                    closeEditUserModal();
                    loadUsers();
                } else {
                    alert('❌ Update failed: ' + result.message);
                }
            } catch (error) {
                alert('❌ Error: ' + error.message);
            }
        }
        
        function confirmDeleteUser(email, name) {
            if (!confirm('Are you sure you want to delete user "' + name + '" (' + email + ')?\n\nThis action cannot be undone.')) {
                return;
            }
            deleteUserByEmail(email);
        }
        
        async function deleteUser() {
            if (!editingUser) return;
            
            if (!confirm('Are you sure you want to delete this user?\n\nThis action cannot be undone.')) {
                return;
            }
            
            await deleteUserByEmail(editingUser.email);
            closeEditUserModal();
        }
        
        async function deleteUserByEmail(email) {
            if (!currentDeviceId) return;
            
            try {
                const response = await fetch('/api/device/' + currentDeviceId + '/delete-user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                    body: JSON.stringify({ email: email })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('✅ User deleted successfully');
                    loadUsers();
                } else {
                    alert('❌ Delete failed: ' + result.message);
                }
            } catch (error) {
                alert('❌ Error: ' + error.message);
            }
        }
        
        // Close modals when clicking outside
        window.onclick = function(event) {
            const modal = document.getElementById('settingsModal');
            const editModal = document.getElementById('editUserModal');
            
            if (event.target === modal) {
                closeModal();
            }
            if (event.target === editModal) {
                closeEditUserModal();
            }
        }
        
        // Initialize page
        loadUserPermissions().then(() => {
            renderDevices();
        });const http = require('http');

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

// Simple dashboard authentication - Default admin users
const DASHBOARD_USERS = new Map([
  ['admin@gatecontroller.com', { password: 'admin123', name: 'Administrator', userLevel: 2, phone: '0000000000' }],
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
  if (req.url.startsWith('/api/user/permissions') && req.method === 'GET') {
    requireAuth((session) => {
      // Find user's permissions across all devices
      const userPermissions = {};
      
      for (const [deviceId, users] of registeredUsers.entries()) {
        const userRecord = users.find(u => u.email === session.email || u.phone === session.phone);
        if (userRecord) {
          userPermissions[deviceId] = {
            relayMask: userRecord.relayMask,
            userLevel: userRecord.userLevel
          };
        }
      }
      
      res.writeHead(200);
      res.end(JSON.stringify({
        userLevel: session.userLevel,
        email: session.email,
        devicePermissions: userPermissions
      }));
    });
    return;
  }

  // Update user endpoint
  if (req.url.includes('/update-user') && req.method === 'POST') {
    requireAuth((session) => {
      const urlParts = req.url.split('/');
      const deviceId = urlParts[3];
      
      console.log(`👤 User update for device: ${deviceId} by ${session.email}`);
      
      readBody((data) => {
        if (!registeredUsers.has(deviceId)) {
          res.writeHead(404);
          res.end(JSON.stringify({ success: false, message: 'Device not found' }));
          return;
        }
        
        const users = registeredUsers.get(deviceId);
        const userIndex = users.findIndex(u => u.email === data.originalEmail);
        
        if (userIndex === -1) {
          res.writeHead(404);
          res.end(JSON.stringify({ success: false, message: 'User not found' }));
          return;
        }
        
        const originalUser = users[userIndex];
        
        // Update user data
        users[userIndex] = {
          ...originalUser,
          email: data.email || originalUser.email,
          phone: data.phone || originalUser.phone,
          name: data.name || originalUser.name,
          password: data.password || originalUser.password,
          relayMask: data.relayMask !== undefined ? data.relayMask : originalUser.relayMask,
          userLevel: data.userLevel !== undefined ? data.userLevel : originalUser.userLevel,
          canLogin: data.canLogin !== undefined ? data.canLogin : originalUser.canLogin,
          lastUpdated: new Date().toISOString()
        };
        
        registeredUsers.set(deviceId, users);
        
        // Update dashboard users if login permission changed
        if (data.canLogin && data.email && data.password) {
          DASHBOARD_USERS.set(data.email, {
            password: data.password,
            name: data.name || originalUser.name,
            userLevel: data.userLevel !== undefined ? data.userLevel : originalUser.userLevel,
            phone: data.phone || originalUser.phone
          });
          
          // Remove old email if it changed
          if (data.email !== data.originalEmail) {
            DASHBOARD_USERS.delete(data.originalEmail);
          }
        } else if (!data.canLogin) {
          // Remove from dashboard users if login disabled
          DASHBOARD_USERS.delete(data.email || data.originalEmail);
        }
        
        // Add log entry
        addDeviceLog(deviceId, 'user_updated', session.email, `User: ${data.name} (${data.email}/${data.phone})`);
        
        console.log(`📝 User updated for device ${deviceId}:`, users[userIndex]);
        
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          message: "User updated successfully",
          user: users[userIndex]
        }));
      });
    });
    return;
  }

  // Delete user endpoint
  if (req.url.includes('/delete-user') && req.method === 'POST') {
    requireAuth((session) => {
      const urlParts = req.url.split('/');
      const deviceId = urlParts[3];
      
      console.log(`👤 User deletion for device: ${deviceId} by ${session.email}`);
      
      readBody((data) => {
        if (!registeredUsers.has(deviceId)) {
          res.writeHead(404);
          res.end(JSON.stringify({ success: false, message: 'Device not found' }));
          return;
        }
        
        const users = registeredUsers.get(deviceId);
        const userIndex = users.findIndex(u => u.email === data.email);
        
        if (userIndex === -1) {
          res.writeHead(404);
          res.end(JSON.stringify({ success: false, message: 'User not found' }));
          return;
        }
        
        const deletedUser = users[userIndex];
        users.splice(userIndex, 1);
        registeredUsers.set(deviceId, users);
        
        // Remove from dashboard users
        DASHBOARD_USERS.delete(data.email);
        
        // Add log entry
        addDeviceLog(deviceId, 'user_deleted', session.email, `User: ${deletedUser.name} (${deletedUser.email})`);
        
        console.log(`🗑️ User deleted from device ${deviceId}:`, deletedUser.email);
        
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          message: "User deleted successfully"
        }));
      });
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

  // Get device schedules endpoint
  if (req.url.startsWith('/api/device/') && req.url.endsWith('/schedules') && req.method === 'GET') {
    requireAuth((session) => {
      const urlParts = req.url.split('/');
      const deviceId = urlParts[3];
      
      const schedules = deviceSchedules.get(deviceId) || [];
      
      res.writeHead(200);
      res.end(JSON.stringify(schedules));
    });
    return;
  }

  // User registration endpoint - require auth
  if (req.url.includes('/register-user') && req.method === 'POST') {
    requireAuth((session) => {
      const urlParts = req.url.split('/');
      const deviceId = urlParts[3];
      
      console.log(`👤 User registration for device: ${deviceId} by ${session.email}`);
      
      readBody((data) => {
        // Store user in registered users
        if (!registeredUsers.has(deviceId)) {
          registeredUsers.set(deviceId, []);
        }
        
        const users = registeredUsers.get(deviceId);
        
        // Check if user already exists (by email or phone)
        const existingUserIndex = users.findIndex(u => u.email === data.email || u.phone === data.phone);
        if (existingUserIndex >= 0) {
          users[existingUserIndex] = {
            email: data.email,
            phone: data.phone,
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
            phone: data.phone,
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
              phone: data.phone
            });
          }
        }
        
        registeredUsers.set(deviceId, users);
        
        const registrationCommand = {
          id: 'reg_' + Date.now(),
          action: 'register_user',
          phone: data.phone,
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
        
        // Add log entry
        addDeviceLog(deviceId, 'user_registered', session.email, `User: ${data.name} (${data.email}/${data.phone})`);
        
        console.log(`📝 Registration queued for device ${deviceId}:`, registrationCommand);
        
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          message: "User registration queued",
          email: data.email,
          phone: data.phone,
          deviceId: deviceId
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
      
      console.log(`🎮 Command sent to ESP32 device: ${deviceId} by ${session.email}`);
      
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
        
        console.log(`📝 Command queued for device ${deviceId}:`, command);
        
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
      const dashboardHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>🚪 Gate Controller Dashboard</title>
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
        .settings-btn { 
            background: #6c757d; 
            color: white; 
            padding: 8px 12px; 
            border: none; 
            border-radius: 4px; 
            cursor: pointer; 
            font-size: 18px;
        }
        .settings-btn:hover { background: #5a6268; }
        h1 { color: #333; margin: 0; }
        .refresh { background: #007bff; color: white; margin-bottom: 20px; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
        
        /* Modal Styles */
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
        }
        .modal-content {
            background-color: white;
            margin: 2% auto;
            padding: 0;
            border-radius: 8px;
            width: 90%;
            max-width: 800px;
            max-height: 90vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        .modal-header {
            background: #667eea;
            color: white;
            padding: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .modal-header h2 { margin: 0; }
        .close-btn {
            background: none;
            border: none;
            color: white;
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .modal-tabs {
            display: flex;
            background: #f8f9fa;
            border-bottom: 1px solid #ddd;
        }
        .tab-btn {
            flex: 1;
            padding: 15px;
            border: none;
            background: none;
            cursor: pointer;
            font-weight: bold;
            border-bottom: 3px solid transparent;
        }
        .tab-btn.active {
            border-bottom-color: #667eea;
            background: white;
            color: #667eea;
        }
        .modal-body {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
        }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        
        /* Form Styles */
        .form-grid { display: grid; gap: 15px; max-width: 500px; }
        input, select { 
            padding: 10px; 
            border: 1px solid #ddd; 
            border-radius: 4px; 
            width: 100%; 
            font-size: 14px;
        }
        .checkbox-group { 
            display: grid; 
            grid-template-columns: 1fr 1fr; 
            gap: 10px; 
            margin: 10px 0; 
        }
        .checkbox-group label { 
            display: flex; 
            align-items: center; 
            gap: 5px; 
            margin: 0; 
            font-weight: normal;
        }
        .register-btn { 
            background: #17a2b8; 
            color: white; 
            padding: 12px 20px; 
            border: none; 
            border-radius: 4px; 
            cursor: pointer; 
            font-weight: bold;
        }
        
        /* Users List */
        .users-list { margin-top: 30px; }
        .user-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            margin-bottom: 10px;
            background: #f8f9fa;
        }
        .user-info { flex: 1; }
        .user-name { font-weight: bold; color: #333; }
        .user-details { font-size: 12px; color: #666; }
        
        /* Logs */
        .log-item {
            padding: 10px;
            border-left: 3px solid #007bff;
            margin-bottom: 10px;
            background: #f8f9fa;
            border-radius: 0 4px 4px 0;
        }
        .log-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 5px;
        }
        .log-action { font-weight: bold; color: #333; }
        .log-time { font-size: 12px; color: #666; }
        .log-details { font-size: 12px; color: #666; }
        
        /* Status */
        .status-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }
        .status-item {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 4px;
            border-left: 4px solid #28a745;
        }
        .status-label { font-weight: bold; color: #333; margin-bottom: 5px; }
        .status-value { color: #666; }
        
        /* User Management Buttons */
        .user-actions {
            display: flex;
            gap: 5px;
        }
        .edit-btn, .delete-btn {
            padding: 4px 8px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        }
        .edit-btn {
            background: #ffc107;
            color: black;
        }
        .delete-btn {
            background: #dc3545;
            color: white;
        }
        .edit-btn:hover { background: #e0a800; }
        .delete-btn:hover { background: #c82333; }
        
        /* Edit User Modal */
        .edit-user-modal {
            display: none;
            position: fixed;
            z-index: 1001;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
        }
        .edit-user-content {
            background-color: white;
            margin: 5% auto;
            padding: 20px;
            border-radius: 8px;
            width: 90%;
            max-width: 500px;
        }
        .edit-user-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid #ddd;
        }
        
        /* Responsive */
        @media (max-width: 768px) {
            .device { flex-direction: column; align-items: flex-start; gap: 10px; }
            .device-actions { width: 100%; justify-content: space-between; }
            .modal-content { width: 95%; margin: 5% auto; }
            .status-grid { grid-template-columns: 1fr; }
        }
        .user-actions {
            display: flex;
            gap: 5px;
        }
        .edit-btn, .delete-btn {
            padding: 4px 8px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        }
        .edit-btn {
            background: #ffc107;
            color: black;
        }
        .delete-btn {
            background: #dc3545;
            color: white;
        }
        .edit-btn:hover { background: #e0a800; }
        .delete-btn:hover { background: #c82333; }
        
        /* Edit User Modal */
        .edit-user-modal {
            display: none;
            position: fixed;
            z-index: 1001;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
        }
        .edit-user-content {
            background-color: white;
            margin: 5% auto;
            padding: 20px;
            border-radius: 8px;
            width: 90%;
            max-width: 500px;
        }
        .edit-user-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid #ddd;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div>
                <h1>🚪 Gate Controller Dashboard</h1>
                <div class="user-info">Logged in as: <strong>${session.name}</strong> (${session.email})</div>
            </div>
            <button class="logout" onclick="logout()">🚪 Logout</button>
        </div>
        
        <button class="refresh" onclick="location.reload()">🔄 Refresh</button>
        
        <div id="devices"></div>
        
        <div class="card">
            <h3>📊 Server Status</h3>
            <p>✅ Server running on port ${PORT}</p>
            <p>🕒 Started: ${new Date().toISOString()}</p>
            <p>📱 Connected Devices: <span id="deviceCount">${connectedDevices.size}</span></p>
            <p>👤 Active Sessions: ${activeSessions.size}</p>
        </div>
    </div>

    <!-- Edit User Modal -->
    <div id="editUserModal" class="edit-user-modal">
        <div class="edit-user-content">
            <div class="edit-user-header">
                <h3>✏️ Edit User</h3>
                <button class="close-btn" onclick="closeEditUserModal()">&times;</button>
            </div>
            
            <div class="form-grid">
                <input type="email" id="editEmail" placeholder="Email Address" required>
                <input type="tel" id="editPhone" placeholder="Phone Number (1234567890)" maxlength="10" required>
                <input type="text" id="editName" placeholder="User Name" required>
                <input type="password" id="editPassword" placeholder="Password (if login allowed)" minlength="6">
                <select id="editUserLevel">
                    <option value="0">👤 Basic User</option>
                    <option value="1">👔 Manager</option>
                    <option value="2">🔐 Admin</option>
                </select>
                <div>
                    <label style="font-weight: bold; margin-bottom: 5px; display: block;">🔑 Permissions:</label>
                    <div class="checkbox-group">
                        <label><input type="checkbox" id="editRelay1"> 🔓 OPEN</label>
                        <label><input type="checkbox" id="editRelay2"> ⏸️ STOP</label>
                        <label><input type="checkbox" id="editRelay3"> 🔒 CLOSE</label>
                        <label><input type="checkbox" id="editRelay4"> ↗️ PARTIAL</label>
                    </div>
                </div>
                <div>
                    <label style="display: flex; align-items: center; gap: 5px; margin: 10px 0;">
                        <input type="checkbox" id="editCanLogin"> 🌐 Allow Dashboard Login
                    </label>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button class="register-btn" onclick="updateUser()" style="flex: 1;">
                        💾 Update User
                    </button>
                    <button class="delete-btn" onclick="deleteUser()" style="flex: 1;">
                        🗑️ Delete User
                    </button>
                </div>
            </div>
        </div>
    </div>

    <script>
        const devices = ${JSON.stringify(Array.from(connectedDevices.entries()))};
        const registeredUsers = ${JSON.stringify(Array.from(registeredUsers.entries()))};
        let currentDeviceId = null;
        let currentUserPermissions = null;
        let editingUser = null;
        
        // Load user permissions on page load
        async function loadUserPermissions() {
            try {
                const response = await fetch('/api/user/permissions');
                const data = await response.json();
                currentUserPermissions = data;
                console.log('User permissions loaded:', currentUserPermissions);
            } catch (error) {
                console.error('Error loading user permissions:', error);
            }
        }
        
        // Check if user has permission for specific relay on device
        function hasRelayPermission(deviceId, relay) {
            if (!currentUserPermissions) return false;
            
            // Admin level users (level 2) can use everything
            if (currentUserPermissions.userLevel >= 2) return true;
            
            // Check device-specific permissions
            const devicePerms = currentUserPermissions.devicePermissions[deviceId];
            if (!devicePerms) return false;
            
            // Manager level (level 1) can use everything on their assigned devices
            if (devicePerms.userLevel >= 1) return true;
            
            // Check specific relay permissions via bitmask
            const relayBit = Math.pow(2, relay - 1); // relay 1 = bit 1, relay 2 = bit 2, etc.
            return (devicePerms.relayMask & relayBit) !== 0;
        }
    <div id="settingsModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2 id="modalTitle">⚙️ Device Settings</h2>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            
            <div class="modal-tabs">
                <button class="tab-btn active" onclick="switchTab('users')">👥 Users</button>
                <button class="tab-btn" onclick="switchTab('status')">📊 Status</button>
                <button class="tab-btn" onclick="switchTab('logs')">📝 Logs</button>
                <button class="tab-btn" onclick="switchTab('schedules')">⏰ Schedules</button>
            </div>
            
            <div class="modal-body">
                <!-- Users Tab -->
                <div id="users-tab" class="tab-content active">
                    <h3>➕ Add New User</h3>
                    <div class="form-grid">
                        <input type="email" id="modalEmail" placeholder="Email Address" required>
                        <input type="tel" id="modalPhone" placeholder="Phone Number (1234567890)" maxlength="10" required>
                        <input type="text" id="modalName" placeholder="User Name" required>
                        <input type="password" id="modalPassword" placeholder="Password (if login allowed)" minlength="6">
                        <select id="modalUserLevel">
                            <option value="0">👤 Basic User</option>
                            <option value="1">👔 Manager</option>
                            <option value="2">🔐 Admin</option>
                        </select>
                        <div>
                            <label style="font-weight: bold; margin-bottom: 5px; display: block;">🔑 Permissions:</label>
                            <div class="checkbox-group">
                                <label><input type="checkbox" id="modalRelay1" checked> 🔓 OPEN</label>
                                <label><input type="checkbox" id="modalRelay2"> ⏸️ STOP</label>
                                <label><input type="checkbox" id="modalRelay3"> 🔒 CLOSE</label>
                                <label><input type="checkbox" id="modalRelay4"> ↗️ PARTIAL</label>
                            </div>
                        </div>
                        <div>
                            <label style="display: flex; align-items: center; gap: 5px; margin: 10px 0;">
                                <input type="checkbox" id="modalCanLogin"> 🌐 Allow Dashboard Login
                            </label>
                            <small style="color: #666;">If checked, user can log in to this dashboard with email and password</small>
                        </div>
                        <button class="register-btn" onclick="registerUserModal()">
                            ➕ Register User
                        </button>
                    </div>
                    
                    <div class="users-list">
                        <h3>👥 Registered Users</h3>
                        <div id="usersList">
                            <p>Loading users...</p>
                        </div>
                    </div>
                </div>
                
                <!-- Status Tab -->
                <div id="status-tab" class="tab-content">
                    <h3>📊 Device Status</h3>
                    <div id="deviceStatus">
                        <p>Loading status...</p>
                    </div>
                </div>
                
                <!-- Logs Tab -->
                <div id="logs-tab" class="tab-content">
                    <h3>📝 Device Logs</h3>
                    <div id="deviceLogs">
                        <p>Loading logs...</p>
                    </div>
                </div>
                
                <!-- Schedules Tab -->
                <div id="schedules-tab" class="tab-content">
                    <h3>⏰ Device Schedules</h3>
                    <div id="deviceSchedules">
                        <p>Schedules feature coming soon...</p>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const devices = ${JSON.stringify(Array.from(connectedDevices.entries()))};
        const registeredUsers = ${JSON.stringify(Array.from(registeredUsers.entries()))};
        let currentDeviceId = null;
        
        async function logout() {
            try {
                await fetch('/dashboard/logout', { method: 'POST' });
                window.location.href = '/dashboard';
            } catch (error) {
                alert('Logout error: ' + error.message);
            }
        }
        
        function sendCommand(deviceId, relay, action) {
            const userId = prompt("Enter your registered phone number:");
            if (!userId) return;
            
            if (!/^\\d{10}$/.test(userId)) {
                alert('Please enter a valid 10-digit phone number');
                return;
            }
            
            if (!confirm('Send ' + action + ' command with user ID: ' + userId + '?')) {
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
                    user_id: parseInt(userId)
                })
            })
            .then(r => r.json())
            .then(d => {
                if (d.success) {
                    alert('✅ Command sent: ' + action);
                } else {
                    alert('❌ Command failed');
                }
            })
            .catch(e => alert('❌ Error: ' + e.message));
        }
        
        function openSettings(deviceId) {
            currentDeviceId = deviceId;
            document.getElementById('modalTitle').textContent = '⚙️ Settings - ' + deviceId;
            document.getElementById('settingsModal').style.display = 'block';
            
            // Switch to users tab and load data
            switchTab('users');
            loadUsers();
        }
        
        function closeModal() {
            document.getElementById('settingsModal').style.display = 'none';
            currentDeviceId = null;
        }
        
        function switchTab(tabName) {
            // Remove active class from all tabs
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            
            // Add active class to selected tab
            event.target.classList.add('active');
            document.getElementById(tabName + '-tab').classList.add('active');
            
            // Load data based on tab
            switch(tabName) {
                case 'users':
                    loadUsers();
                    break;
                case 'status':
                    loadStatus();
                    break;
                case 'logs':
                    loadLogs();
                    break;
                case 'schedules':
                    loadSchedules();
                    break;
            }
        }
        
        async function loadUsers() {
            if (!currentDeviceId) return;
            
            try {
                const response = await fetch('/api/device/' + currentDeviceId + '/users');
                const users = await response.json();
                
                const usersList = document.getElementById('usersList');
                
                if (users.length === 0) {
                    usersList.innerHTML = '<p style="color: #666;">No users registered yet.</p>';
                    return;
                }
                
                usersList.innerHTML = users.map(user => {
                    const permissions = [];
                    if (user.relayMask & 1) permissions.push('🔓 OPEN');
                    if (user.relayMask & 2) permissions.push('⏸️ STOP');
                    if (user.relayMask & 4) permissions.push('🔒 CLOSE');
                    if (user.relayMask & 8) permissions.push('↗️ PARTIAL');
                    
                    const userLevelText = ['👤 Basic', '👔 Manager', '🔐 Admin'][user.userLevel] || '👤 Basic';
                    const loginStatus = user.canLogin ? '🌐 Can Login' : '🚫 No Login';
                    
                    // Only show edit/delete buttons for admins or managers
                    const canManageUsers = currentUserPermissions && currentUserPermissions.userLevel >= 1;
                    
                    return \`
                        <div class="user-item">
                            <div class="user-info">
                                <div class="user-name">\${user.name} \${user.canLogin ? '🌐' : ''}</div>
                                <div class="user-details">
                                    📧 \${user.email} | 📱 \${user.phone} | \${userLevelText} | \${loginStatus}<br>
                                    Permissions: \${permissions.join(', ')} |
                                    Registered: \${new Date(user.registeredAt).toLocaleDateString()}
                                </div>
                            </div>
                            \${canManageUsers ? \`
                                <div class="user-actions">
                                    <button class="edit-btn" onclick="editUser('\${user.email}')" title="Edit User">✏️</button>
                                    <button class="delete-btn" onclick="confirmDeleteUser('\${user.email}', '\${user.name}')" title="Delete User">🗑️</button>
                                </div>
                            \` : ''}
                        </div>
                    \`;
                }).join('');
                
            } catch (error) {
                document.getElementById('usersList').innerHTML = '<p style="color: #dc3545;">Error loading users: ' + error.message + '</p>';
            }
        }
        
        async function loadStatus() {
            if (!currentDeviceId) return;
            
            const device = devices.find(([id]) => id === currentDeviceId);
            if (!device) return;
            
            const [deviceId, info] = device;
            const isOnline = (Date.now() - new Date(info.lastHeartbeat).getTime()) < 60000;
            
            document.getElementById('deviceStatus').innerHTML = \`
                <div class="status-grid">
                    <div class="status-item">
                        <div class="status-label">🌐 Connection Status</div>
                        <div class="status-value">\${isOnline ? '🟢 Online' : '🔴 Offline'}</div>
                    </div>
                    <div class="status-item">
                        <div class="status-label">📶 Signal Strength</div>
                        <div class="status-value">\${info.signalStrength} dBm</div>
                    </div>
                    <div class="status-item">
                        <div class="status-label">🔋 Battery Level</div>
                        <div class="status-value">\${info.batteryLevel}%</div>
                    </div>
                    <div class="status-item">
                        <div class="status-label">⏱️ Uptime</div>
                        <div class="status-value">\${Math.floor(info.uptime / 1000)} seconds</div>
                    </div>
                    <div class="status-item">
                        <div class="status-label">🧠 Free Memory</div>
                        <div class="status-value">\${info.freeHeap} bytes</div>
                    </div>
                    <div class="status-item">
                        <div class="status-label">🔄 Last Heartbeat</div>
                        <div class="status-value">\${new Date(info.lastHeartbeat).toLocaleString()}</div>
                    </div>
                    <div class="status-item">
                        <div class="status-label">📱 Firmware Version</div>
                        <div class="status-value">\${info.firmwareVersion}</div>
                    </div>
                    <div class="status-item">
                        <div class="status-label">🌐 Connection Type</div>
                        <div class="status-value">\${info.connectionType}</div>
                    </div>
                </div>
            \`;
        }
        
        async function loadLogs() {
            if (!currentDeviceId) return;
            
            try {
                const response = await fetch('/api/device/' + currentDeviceId + '/logs');
                const logs = await response.json();
                
                const logsContainer = document.getElementById('deviceLogs');
                
                if (logs.length === 0) {
                    logsContainer.innerHTML = '<p style="color: #666;">No logs available.</p>';
                    return;
                }
                
                logsContainer.innerHTML = logs.map(log => \`
                    <div class="log-item">
                        <div class="log-header">
                            <span class="log-action">📝 \${log.action.replace('_', ' ').toUpperCase()}</span>
                            <span class="log-time">\${new Date(log.timestamp).toLocaleString()}</span>
                        </div>
                        <div class="log-details">
                            👤 User: \${log.user} | \${log.details}
                        </div>
                    </div>
                \`).join('');
                
            } catch (error) {
                document.getElementById('deviceLogs').innerHTML = '<p style="color: #dc3545;">Error loading logs: ' + error.message + '</p>';
            }
        }
        
        async function loadSchedules() {
            if (!currentDeviceId) return;
            
            document.getElementById('deviceSchedules').innerHTML = \`
                <div style="text-align: center; padding: 40px; color: #666;">
                    <h4>⏰ Schedules Feature</h4>
                    <p>This feature will allow you to:</p>
                    <ul style="text-align: left; max-width: 300px; margin: 0 auto;">
                        <li>📅 Schedule automatic gate operations</li>
                        <li>🕐 Set recurring time-based commands</li>
                        <li>👥 Assign user-specific schedules</li>
                        <li>🎯 Configure conditional triggers</li>
                    </ul>
                    <p><strong>Coming in the next update!</strong></p>
                </div>
            \`;
        }
        
        async function registerUserModal() {
            if (!currentDeviceId) return;
            
            const email = document.getElementById('modalEmail').value;
            const phone = document.getElementById('modalPhone').value;
            const name = document.getElementById('modalName').value;
            const password = document.getElementById('modalPassword').value;
            const userLevel = parseInt(document.getElementById('modalUserLevel').value);
            const canLogin = document.getElementById('modalCanLogin').checked;
            
            let relayMask = 0;
            if (document.getElementById('modalRelay1').checked) relayMask |= 1;
            if (document.getElementById('modalRelay2').checked) relayMask |= 2;
            if (document.getElementById('modalRelay3').checked) relayMask |= 4;
            if (document.getElementById('modalRelay4').checked) relayMask |= 8;
            
            if (!email || !phone || !name) {
                alert('Please fill in email, phone, and name fields');
                return;
            }
            
            if (!/^\\d{10}$/.test(phone)) {
                alert('Please enter a valid 10-digit phone number');
                return;
            }
            
            if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
                alert('Please enter a valid email address');
                return;
            }
            
            if (canLogin && (!password || password.length < 6)) {
                alert('Password must be at least 6 characters if login is allowed');
                return;
            }
            
            try {
                const response = await fetch('/api/device/' + currentDeviceId + '/register-user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                    body: JSON.stringify({
                        email: email,
                        phone: parseInt(phone),
                        name: name,
                        password: password,
                        relayMask: relayMask,
                        userLevel: userLevel,
                        canLogin: canLogin
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('✅ User registered: ' + name + ' (' + email + ')');
                    
                    // Clear form
                    document.getElementById('modalEmail').value = '';
                    document.getElementById('modalPhone').value = '';
                    document.getElementById('modalName').value = '';
                    document.getElementById('modalPassword').value = '';
                    document.getElementById('modalUserLevel').value = '0';
                    document.getElementById('modalCanLogin').checked = false;
                    document.querySelectorAll('#settingsModal input[type="checkbox"]').forEach(cb => cb.checked = false);
                    document.getElementById('modalRelay1').checked = true;
                    
                    // Reload users list
                    loadUsers();
                } else {
                    alert('❌ Registration failed');
                }
            } catch (error) {
                alert('❌ Error: ' + error.message);
            }
        }
        
        function renderDevices() {
            const container = document.getElementById('devices');
            if (devices.length === 0) {
                container.innerHTML = '<div class="card"><p>📭 No devices connected yet. Waiting for ESP32 heartbeat...</p></div>';
                return;
            }
            
            container.innerHTML = devices.map(([deviceId, info]) => {
                const isOnline = (Date.now() - new Date(info.lastHeartbeat).getTime()) < 60000;
                const deviceUsers = registeredUsers.find(([id]) => id === deviceId);
                const userCount = deviceUsers ? deviceUsers[1].length : 0;
                
                // Generate control buttons based on user permissions
                let controlButtons = '';
                
                if (hasRelayPermission(deviceId, 1)) {
                    controlButtons += \`<button class="control-btn open" onclick="sendCommand('\${deviceId}', 1, 'OPEN')">🔓 OPEN</button>\`;
                }
                if (hasRelayPermission(deviceId, 2)) {
                    controlButtons += \`<button class="control-btn stop" onclick="sendCommand('\${deviceId}', 2, 'STOP')">⏸️ STOP</button>\`;
                }
                if (hasRelayPermission(deviceId, 3)) {
                    controlButtons += \`<button class="control-btn close" onclick="sendCommand('\${deviceId}', 3, 'CLOSE')">🔒 CLOSE</button>\`;
                }
                if (hasRelayPermission(deviceId, 4)) {
                    controlButtons += \`<button class="control-btn partial" onclick="sendCommand('\${deviceId}', 4, 'PARTIAL')">↗️ PARTIAL</button>\`;
                }
                
                // Only show settings button for managers and admins
                const canManage = currentUserPermissions && currentUserPermissions.userLevel >= 1;
                const settingsButton = canManage ? 
                    \`<button class="settings-btn" onclick="openSettings('\${deviceId}')" title="Device Settings">⚙️</button>\` : '';
                
                return \`
                    <div class="card device \${isOnline ? '' : 'offline'}">
                        <div class="device-info">
                            <h3>🎛️ \${deviceId} \${isOnline ? '🟢' : '🔴'}</h3>
                            <div class="device-status">
                                📶 Signal: \${info.signalStrength}dBm | 
                                🔋 Battery: \${info.batteryLevel}% | 
                                ⏱️ Uptime: \${Math.floor(info.uptime / 1000)}s |
                                👥 Users: \${userCount}<br>
                                🔄 Last Heartbeat: \${new Date(info.lastHeartbeat).toLocaleTimeString()}
                            </div>
                        </div>
                        
                        <div class="device-actions">
                            \${controlButtons}
                            \${settingsButton}
                        </div>
                    </div>
                \`;
            }).join('');
        }
        
        // Close modals when clicking outside
        window.onclick = function(event) {
            const modal = document.getElementById('settingsModal');
            const editModal = document.getElementById('editUserModal');
            
            if (event.target === modal) {
                closeModal();
            }
            if (event.target === editModal) {
                closeEditUserModal();
            }
        }
        
        // Initialize page
        loadUserPermissions().then(() => {
            renderDevices();
        });
    </script>
</body>
</html>`;
      
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(dashboardHtml);
    });
    return;
  }
    </script>
</body>
</html>`;
      
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(dashboardHtml);
    });
    return;
  }

  // Health check endpoint (public)
  if (req.url === '/health') {
    const responseData = {
      message: '🎉 Railway server is working perfectly!',
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
      message: '🎉 Gate Controller API with User Management and Authentication',
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
        'POST /api/device/{deviceId}/send-command (requires login)',
        'POST /api/device/{deviceId}/register-user (requires login)',
        'GET /api/device/{deviceId}/users (requires login)',
        'GET /api/device/{deviceId}/logs (requires login)',
        'GET /api/device/{deviceId}/schedules (requires login)'
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
    message: '🎉 Railway Gate Controller Server with Authentication',
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
  console.error('❌ Server error:', err);
  console.error('Error details:', {
    code: err.code,
    message: err.message,
    port: PORT
  });
});

server.on('listening', () => {
  const addr = server.address();
  console.log('🎉 Server successfully listening with Authentication!');
  console.log(`✅ Port: ${addr.port}`);
  console.log(`✅ Address: ${addr.address}`);
  console.log(`🌐 Railway should now be able to route traffic`);
  console.log(`📱 Dashboard: https://gate-controller-system-production.up.railway.app/dashboard`);
  console.log(`🔐 Demo Login: admin@gatecontroller.com/admin123 or manager@gatecontroller.com/gate2024`);
});

// Start server
server.listen(PORT, '0.0.0.0', (err) => {
  if (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
  console.log(`💫 Server started on ${PORT} with Authentication`);
});

// Health check endpoint logging
setInterval(() => {
  console.log(`💓 Server heartbeat - Port: ${PORT} - Devices: ${connectedDevices.size} - Sessions: ${activeSessions.size} - ${new Date().toISOString()}`);
  
  // Clean up old devices (offline for more than 5 minutes)
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  for (const [deviceId, info] of connectedDevices.entries()) {
    if (new Date(info.lastHeartbeat).getTime() < fiveMinutesAgo) {
      console.log(`🗑️ Removing offline device: ${deviceId}`);
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
      console.log(`🗑️ Removing expired session: ${session.email}`);
      activeSessions.delete(sessionToken);
    }
  }
}, 30000);
