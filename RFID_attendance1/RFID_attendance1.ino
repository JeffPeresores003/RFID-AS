#include <SPI.h>
#include <MFRC522.h>

// Define pins
#define RST_PIN         9     // Reset pin
#define SS_PIN          10    // Slave Select pin (connects to SDA on RC522 module)
#define BUZZER_PIN      8     // Buzzer control pin

// Create MFRC522 instance
MFRC522 mfrc522(SS_PIN, RST_PIN); 

unsigned long lastRfidHealthCheck = 0;
unsigned long lastSuccessfulRead = 0;
unsigned long lastReaderRefresh = 0;

bool initRFIDModule() {
  for (byte attempt = 1; attempt <= 5; attempt++) {
    mfrc522.PCD_Init();
    delay(80);

    byte version = mfrc522.PCD_ReadRegister(mfrc522.VersionReg);
    Serial.print(F("RFID init attempt "));
    Serial.print(attempt);
    Serial.print(F(" - Version: 0x"));
    Serial.println(version, HEX);

    if (version != 0x00 && version != 0xFF) {
      mfrc522.PCD_SetAntennaGain(mfrc522.RxGain_max);
      Serial.println(F("RFID module initialized successfully"));
      return true;
    }

    mfrc522.PCD_Reset();
    delay(120);
  }

  Serial.println(F("WARNING: RC522 not responding after retries"));
  return false;
}

void setup() {
  Serial.begin(9600);        // Initialize serial communications
  
  // Wait for serial port to be ready (important after reset)
  while (!Serial && millis() < 3000) {
    ; // Wait for serial port to connect, max 3 seconds
  }
  
  SPI.begin();               // Init SPI bus
  delay(100);                // Allow SPI/RC522 power-up to stabilize

  initRFIDModule();          // Init MFRC522 card with retries
  
  // Setup Buzzer
  pinMode(BUZZER_PIN, OUTPUT);
  noTone(BUZZER_PIN);        // Ensure buzzer is off at start
  
  Serial.println(F("RFID Scanner Test"));
  Serial.println(F("Scan a card or tag..."));
  
  // Optional: Check firmware version
  byte version = mfrc522.PCD_ReadRegister(mfrc522.VersionReg);
  Serial.print(F("MFRC522 Firmware Version: 0x"));
  Serial.println(version, HEX);
  if (version == 0x00 || version == 0xFF) {
    Serial.println(F("WARNING: Communication failure, is the MFRC522 properly connected?"));
  } else {
    Serial.println(F("Antenna gain set to maximum"));
  }
  
  // Additional delay for module stabilization after reset
  delay(500);
  
  // Signal that Arduino is ready
  Serial.println(F("Scanner ready"));
  Serial.flush(); // Ensure all data is sent before continuing
}

void loop() {
  // Periodic refresh: recover cases where reader is responsive but card detection stalls
  if (millis() - lastSuccessfulRead > 5000 && millis() - lastReaderRefresh > 5000) {
    lastReaderRefresh = millis();
    mfrc522.PCD_Reset();
    delay(40);
    initRFIDModule();
  }

  // Health check: auto-recover RFID reader if communication drops
  if (millis() - lastRfidHealthCheck > 3000) {
    lastRfidHealthCheck = millis();
    byte version = mfrc522.PCD_ReadRegister(mfrc522.VersionReg);
    if (version == 0x00 || version == 0xFF) {
      Serial.println(F("RFID communication lost, reinitializing..."));
      initRFIDModule();
      delay(100);
      return;
    }
  }

  // Look for new cards
  if ( ! mfrc522.PICC_IsNewCardPresent()) {
    return;
  }

  // Select one of the cards
  if ( ! mfrc522.PICC_ReadCardSerial()) {
    return;
  }

  // Build UID string
  String uidString = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (i > 0) uidString += " ";
    if (mfrc522.uid.uidByte[i] < 0x10) uidString += "0";
    uidString += String(mfrc522.uid.uidByte[i], HEX);
  }
  uidString.toUpperCase();
  lastSuccessfulRead = millis();

  // Send UID in JSON format for easy parsing by server
  Serial.print("{\"uid\":\"");
  Serial.print(uidString);
  Serial.println("\"}");
  Serial.flush(); // Ensure data is sent immediately

  // --- SUCCESS! Trigger Buzzer for 200ms ---
  tone(BUZZER_PIN, 1000, 200);  // 1000Hz frequency, 200ms beep
  // --------------------------------------------

  // Halt the card to stop communication
  mfrc522.PICC_HaltA();
  
  // Stop encryption on PCD
  mfrc522.PCD_StopCrypto1();
  
  // Wait to prevent duplicate reads
  delay(1000); 
}