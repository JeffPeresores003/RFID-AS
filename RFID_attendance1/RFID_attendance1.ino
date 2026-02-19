#include <SPI.h>
#include <MFRC522.h>

// Define pins
#define RST_PIN         9     // Reset pin
#define SS_PIN          10    // Slave Select pin
#define BUZZER_PIN      8     // Buzzer control pin

// Create MFRC522 instance
MFRC522 mfrc522(SS_PIN, RST_PIN); 

void setup() {
  Serial.begin(9600);        // Initialize serial communications
  
  SPI.begin();               // Init SPI bus
  mfrc522.PCD_Init();        // Init MFRC522 card
  
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
  }
}

void loop() {
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

  // Send UID in JSON format for easy parsing by server
  Serial.print("{\"uid\":\"");
  Serial.print(uidString);
  Serial.println("\"}");

  // --- SUCCESS! Trigger Buzzer for 200ms ---
  tone(BUZZER_PIN, 1000, 200);  // 1000Hz frequency, 200ms beep
  // --------------------------------------------

  // Halt the card to stop communication
  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
  
  // Wait 1 second to prevent duplicate reads
  delay(1000); 
}