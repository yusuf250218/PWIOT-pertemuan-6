#include <WiFi.h>
#include <FirebaseESP32.h>
#include <Adafruit_NeoPixel.h>
#include <time.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ---------------- WiFi ----------------
#define WIFI_SSID "iyus_ysf"
#define WIFI_PASSWORD "12345678"

// ---------------- Firebase ------------
#define FIREBASE_HOST "uaspwiot-le105-default-rtdb.asia-southeast1.frebasedatabase.app"
#define FIREBASE_AUTH "AIzaSyCG2BpGQPc2dtmA_c6a3MiFjzRymMcz-qk"
FirebaseData firebaseData;
FirebaseAuth auth;
FirebaseConfig config;

// ---------------- Sensor & LED --------
#define TRIG_PIN 35
#define ECHO_PIN 36
#define LED_PIN 15
#define NUM_LEDS 1
Adafruit_NeoPixel strip(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

// ---------------- Sensor Suhu DS18B20 --
#define ONE_WIRE_BUS 21
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);

// ---------------- Motor Stepper (EN/DIR/PUL) -------
#define EN_PIN 14    // Enable pin
#define DIR_PIN 27   // Direction pin
#define PUL_PIN 26   // Pulse pin
#define STEPS_PER_REV 200  // Sesuaikan dengan motor stepper Anda

// ---------------- Variabel Global -----
String stepperState = "STOP";
unsigned long lastStepTime = 0;
const unsigned long stepDelay = 500; // Delay antar step (microseconds)

// ---------------- Setup ----------------
void setup() {
  Serial.begin(115200);

  // Koneksi WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Menghubungkan ke WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print(".");
  }
  Serial.println("\nWiFi Terhubung");

  // Waktu NTP
  configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");

  // Firebase
  config.host = FIREBASE_HOST;
  config.signer.tokens.legacy_token = FIREBASE_AUTH;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  // Inisialisasi sensor dan LED
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  strip.begin(); 
  strip.show();
  
  // Inisialisasi sensor suhu
  sensors.begin();
  
  // Inisialisasi pin stepper
  pinMode(EN_PIN, OUTPUT);
  pinMode(DIR_PIN, OUTPUT);
  pinMode(PUL_PIN, OUTPUT);
  digitalWrite(EN_PIN, HIGH); // Non-aktifkan motor awal
}

// ---------------- Loop -----------------
void loop() {
  // Baca Jarak Ultrasonik
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH);
  float distance = duration * 0.034 / 2.0;

  // Baca Suhu DS18B20
  sensors.requestTemperatures();
  float temperature = sensors.getTempCByIndex(0);

  // Waktu
  time_t now = time(nullptr);
  struct tm* timeinfo = localtime(&now);
  char waktuStr[30];
  strftime(waktuStr, sizeof(waktuStr), "%d/%m/%Y %H:%M:%S", timeinfo);
  int unixTime = now;

  // Kontrol LED berdasarkan jarak
  if (distance > 20.0) {
    setLEDColor(0, 255, 0); // Hijau jika jarak > 20cm
  } else {
    setLEDColor(255, 0, 0); // Merah jika jarak <= 20cm
  }

  // Kirim data sensor ke Firebase
  String path = "/kontrol";
  Firebase.setFloat(firebaseData, path + "/jarak", distance);
  Firebase.setFloat(firebaseData, path + "/suhu", temperature);
  Firebase.setInt(firebaseData, path + "/timestamp", unixTime);
  Firebase.setString(firebaseData, path + "/waktu", waktuStr);

  // Baca perintah motor stepper dari Serial
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    
    if (command == "CW" || command == "CCW" || command == "STOP") {
      stepperState = command;
      Firebase.setString(firebaseData, path + "/stepper", command);
    }
  }

  // Baca perintah motor stepper dari Firebase
  if (Firebase.getString(firebaseData, path + "/stepper")) {
    String fbStepperState = firebaseData.stringData();
    fbStepperState.trim();
    
    if (fbStepperState == "CW" || fbStepperState == "CCW" || fbStepperState == "STOP") {
      stepperState = fbStepperState;
    }
  }

  // Eksekusi perintah motor stepper
  kontrolStepper();

  delay(100); // Delay utama loop
}

// ---------------- Fungsi LED -----------
void setLEDColor(uint8_t r, uint8_t g, uint8_t b) {
  strip.setPixelColor(0, strip.Color(r, g, b));
  strip.show();
}

// ---------------- Fungsi Stepper Control -----------
void kontrolStepper() {
  static bool pulseState = LOW;
  
  if (stepperState == "STOP") {
    digitalWrite(EN_PIN, HIGH); // Disable driver
    return;
  }
  
  // Set direction
  if (stepperState == "CW") {
    digitalWrite(DIR_PIN, HIGH);
  } else if (stepperState == "CCW") {
    digitalWrite(DIR_PIN, LOW);
  }
  
  // Enable driver
  digitalWrite(EN_PIN, LOW);
  
  // Generate pulse
  if (micros() - lastStepTime >= stepDelay) {
    pulseState = !pulseState;
    digitalWrite(PUL_PIN, pulseState);
    if (pulseState == HIGH) {
      lastStepTime = micros();
    }
  }
}