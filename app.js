const express = require('express');
const session = require('express-session');
const path = require('path');
const mysql = require('mysql2');
const admin = require('firebase-admin');
const app = express();

// ==== MySQL Connection ====
const mysqlDb = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '', // ganti jika punya password
  database: 'iot_dashboard'
});

mysqlDb.connect(err => {
  if (err) throw err;
  console.log('✅ Connected to MySQL database');
});

module.exports = mysqlDb;

// ==== Middleware ====
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'iotdashboardsecret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// ==== Firebase Admin ====
const serviceAccount = require('./uaspwiot-1e105-firebase-adminsdk-fbsvc-4ec4bf398b.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://uaspwiot-1e105-default-rtdb.asia-southeast1.firebasedatabase.app"
});
const db = admin.database();

// ==== View Engine ====
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// ==== Auth Middleware ====
const isAuthenticated = (req, res, next) => {
  if (req.session.user) return next();
  res.redirect('/login');
};

const checkRole = (roles) => {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (roles.includes(req.session.user.role)) return next();
    res.status(403).render('error', {
      title: 'Access Denied',
      message: 'Access Denied',
      error: { status: 403 },
      user: req.session.user
    });
  };
};

// ==== Routes ====
const authRoutes = require('./routes/auth');
app.use(authRoutes);

app.get('/dashboard', isAuthenticated, async (req, res) => {
  try {
    const snapshot = await db.ref('sensor/data').once('value');
    const data = snapshot.val() || {};

    res.render('dashboard', {
      title: 'Dashboard',
      user: req.session.user,
      data,
      activePage: 'dashboard'
    });
  } catch (error) {
    res.render('dashboard', {
      title: 'Dashboard',
      user: req.session.user,
      data: { suhu: 'N/A', jarak: 'N/A', stepper: 'IDLE' },
      error: 'Failed to load sensor data',
      activePage: 'dashboard'
    });
  }
});

app.get('/sensors', isAuthenticated, async (req, res) => {
  try {
    const snapshot = await db.ref('sensor/data').once('value');
    const data = snapshot.val() || {};

    const sensors = [
      { id: 1, name: 'Temperature', value: data.suhu ? `${data.suhu} °C` : 'N/A', icon: 'fa-thermometer-half' },
      { id: 2, name: 'Distance', value: data.jarak ? `${data.jarak} cm` : 'N/A', icon: 'fa-ruler-vertical' },
      { id: 3, name: 'Stepper Status', value: data.stepper || 'IDLE', icon: 'fa-cog' }
    ];

    res.render('sensors', {
      title: 'Sensors',
      sensors,
      user: req.session.user,
      activePage: 'sensors'
    });
  } catch (error) {
    res.render('sensors', {
      title: 'Sensors',
      sensors: [],
      user: req.session.user,
      error: 'Failed to load sensor data',
      activePage: 'sensors'
    });
  }
});

app.get('/actuators', isAuthenticated, checkRole(['admin', 'foreman', 'leader']), async (req, res) => {
  try {
    const snapshot = await db.ref('kontrol').once('value');
    const controlData = snapshot.val() || {};

    const actuators = [
      {
        id: 1,
        name: 'Stepper Motor',
        status: controlData.stepper || 'IDLE',
        directions: ['FORWARD', 'BACKWARD', 'STOP'],
        icon: 'fa-motorcycle'
      }
    ];

    res.render('actuators', {
      title: 'Actuators',
      actuators,
      user: req.session.user,
      activePage: 'actuators'
    });
  } catch (error) {
    res.render('actuators', {
      title: 'Actuators',
      actuators: [],
      user: req.session.user,
      error: 'Failed to load actuator data',
      activePage: 'actuators'
    });
  }
});

app.post('/api/actuator/control', isAuthenticated, checkRole(['admin', 'foreman', 'leader']), async (req, res) => {
  try {
    const { id, direction } = req.body;
    if (!id || !direction) return res.status(400).json({ success: false, message: 'Invalid parameters' });

    await db.ref('kontrol/stepper').set(direction.toUpperCase());

    res.json({
      success: true,
      message: `Actuator ${id} set to ${direction.toUpperCase()}`,
      direction: direction.toUpperCase()
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to control actuator' });
  }
});

app.get('/charts', isAuthenticated, async (req, res) => {
  try {
    const chartData = {
      temperature: {
        labels: Array(24).fill().map((_, i) => `${i}:00`),
        data: Array(24).fill().map(() => Math.floor(Math.random() * 10) + 20)
      },
      distance: {
        labels: Array(24).fill().map((_, i) => `${i}:00`),
        data: Array(24).fill().map(() => Math.floor(Math.random() * 50) + 10)
      }
    };

    res.render('charts', {
      title: 'Charts',
      chartData,
      user: req.session.user,
      activePage: 'charts'
    });
  } catch (error) {
    res.render('charts', {
      title: 'Charts',
      chartData: null,
      user: req.session.user,
      error: 'Failed to load chart data',
      activePage: 'charts'
    });
  }
});

app.get('/profile', isAuthenticated, (req, res) => {
  res.render('profile', {
    title: 'My Profile',
    user: req.session.user,
    activePage: 'profile'
  });
});

// ==== Error Handlers ====
app.use((req, res, next) => {
  res.status(404).render('error', {
    title: 'Page Not Found',
    message: 'The page you requested could not be found',
    error: { status: 404 },
    user: req.session.user
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    title: 'Server Error',
    message: 'Something went wrong on our side',
    error: { status: 500 },
    user: req.session.user
  });
});

// ==== Start Server ====
const PORT = process.env.PORT || 3300;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
