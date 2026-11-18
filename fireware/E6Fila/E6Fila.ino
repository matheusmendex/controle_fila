#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "secrets.h"

namespace Pins {
  constexpr uint8_t BUTTON_COMMON   = 32;
  constexpr uint8_t BUTTON_PRIORITY = 33;
  constexpr uint8_t BUTTON_REPEAT   = 25;
  constexpr uint8_t BUZZER          = 26;
  constexpr uint8_t LED_OK          = 27;
  constexpr uint8_t LED_ALERT       = 14; // Segundo LED sugerido pelo grupo
  constexpr uint8_t OLED_SDA        = 21;
  constexpr uint8_t OLED_SCL        = 22;
}

constexpr unsigned long DEBOUNCE_MS      = 180;
constexpr unsigned long COMMAND_POLL_MS  = 2500;
constexpr unsigned long WIFI_RETRY_MS    = 5000;
constexpr uint32_t BUZZER_FREQ_HZ        = 2000;
constexpr uint8_t BUZZER_RESOLUTION_BITS = 8;

Adafruit_SSD1306 display(128, 64, &Wire, -1);
bool hasOled = false;

Preferences storage;
unsigned long sequenceNumber  = 0;
unsigned long lastCommandPoll = 0;
unsigned long lastWifiRetry   = 0;
String lastCalledTicket       = "---";
String lastCalledDesk         = "---";

struct Button {
  uint8_t pin;
  bool previousState = HIGH;
  unsigned long lastPress = 0;

  void begin() {
    pinMode(pin, INPUT_PULLUP);
    previousState = digitalRead(pin);
  }

  bool wasPressed() {
    const bool currentState = digitalRead(pin);
    const unsigned long now = millis();
    const bool pressed = (previousState == HIGH) && (currentState == LOW) && ((now - lastPress) >= DEBOUNCE_MS);
    if (pressed) lastPress = now;
    previousState = currentState;
    return pressed;
  }
};

Button commonButton{Pins::BUTTON_COMMON};
Button priorityButton{Pins::BUTTON_PRIORITY};
Button repeatButton{Pins::BUTTON_REPEAT};

void updateDisplay(const String& line1, const String& line2, const String& line3 = "") {
  if (!hasOled) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println(line1);

  display.setTextSize(2);
  display.setCursor(0, 20);
  display.println(line2);

  display.setTextSize(1);
  display.setCursor(0, 48);
  display.println(line3);
  display.display();
}

// Sinal curto: senha emitida com sucesso
void playEmitSignal() {
  digitalWrite(Pins::LED_OK, HIGH);
  ledcWriteTone(Pins::BUZZER, 1800);
  delay(150);
  ledcWriteTone(Pins::BUZZER, 0);
  digitalWrite(Pins::LED_OK, LOW);
}

// Sinal duplo: chamada do atendente (mais audível para a sala de espera)
void playCallSignal() {
  for (int i = 0; i < 2; i++) {
    digitalWrite(Pins::LED_OK, HIGH);
    digitalWrite(Pins::LED_ALERT, HIGH);
    ledcWriteTone(Pins::BUZZER, 2200);
    delay(220);
    ledcWriteTone(Pins::BUZZER, 0);
    digitalWrite(Pins::LED_OK, LOW);
    digitalWrite(Pins::LED_ALERT, LOW);
    if (i == 0) delay(120);
  }
}

// Sinal de erro: falha de rede ou backend (avisa que NÃO gerou senha)
void playErrorSignal() {
  for (int i = 0; i < 3; i++) {
    digitalWrite(Pins::LED_ALERT, HIGH);
    ledcWriteTone(Pins::BUZZER, 900);
    delay(90);
    ledcWriteTone(Pins::BUZZER, 0);
    digitalWrite(Pins::LED_ALERT, LOW);
    delay(70);
  }
}

bool postJson(const String& path, JsonDocument& document, JsonDocument* responseOut = nullptr) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("postJson: sem Wi-Fi.");
    return false;
  }

  HTTPClient http;
  WiFiClientSecure secureClient;
  http.setTimeout(3000);
  const String url = String(API_URL) + path;
  // A API publicada no Railway usa HTTPS. Para produção, prefira setCACert()
  // com a CA raiz do domínio; setInsecure() mantém a compatibilidade com o guia.
  secureClient.setInsecure();
  const bool started = url.startsWith("https://") ? http.begin(secureClient, url) : http.begin(url);
  if (!started) {
    Serial.println("postJson: falha ao iniciar HTTP.");
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);

  String body;
  serializeJson(document, body);
  const int status = http.POST(body);

  if (status >= 200 && status < 300) {
    if (responseOut != nullptr) {
      deserializeJson(*responseOut, http.getStream());
    }
    http.end();
    return true;
  }

  Serial.printf("postJson: falha (%s) status %d\n", path.c_str(), status);
  http.end();
  return false;
}

void sendButtonEvent(const char* type) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Sem Wi-Fi: toque rejeitado.");
    updateDisplay("SEM REDE (OFFLINE)", "ERRO", "Tente novamente");
    playErrorSignal();
    return;
  }

  JsonDocument event;
  event["device_id"] = DEVICE_ID;
  event["tipo"] = type;
  event["sequencia"] = ++sequenceNumber;
  event["dados"]["origem"] = "botao_fisico";
  storage.putULong("sequence", sequenceNumber);

  JsonDocument response;
  if (postJson("/api/eventos", event, &response)) {
    const String ticketCode = response["senha"] | "EMITIDA";
    Serial.printf("Evento enviado: %s -> %s\n", type, ticketCode.c_str());
    updateDisplay("SENHA EMITIDA:", ticketCode, "Aguarde a chamada");
    playEmitSignal();
  } else {
    Serial.println("Backend nao confirmou o evento.");
    updateDisplay("FALHA NO SERVIDOR", "ERRO", "Senha nao gerada");
    playErrorSignal();
  }
}

void confirmCommand(const String& commandId, bool success, const char* message) {
  JsonDocument confirmation;
  confirmation["status"] = success ? "executado" : "falhou";
  confirmation["retorno"] = message;
  postJson("/api/comandos/" + commandId + "/confirmacao", confirmation);
}

void pollCommands() {
  if (WiFi.status() != WL_CONNECTED || millis() - lastCommandPoll < COMMAND_POLL_MS) return;
  lastCommandPoll = millis();

  HTTPClient http;
  WiFiClientSecure secureClient;
  http.setTimeout(3000);
  const String url = String(API_URL) + "/api/comandos/pendentes?device=" + DEVICE_ID;
  secureClient.setInsecure();
  const bool started = url.startsWith("https://") ? http.begin(secureClient, url) : http.begin(url);
  if (!started) return;
  http.addHeader("x-device-key", DEVICE_KEY);

  const int status = http.GET();
  if (status != 200) {
    http.end();
    return;
  }

  JsonDocument commands;
  const DeserializationError error = deserializeJson(commands, http.getStream());
  http.end();

  if (error || !commands.is<JsonArray>()) return;

  for (JsonObject command : commands.as<JsonArray>()) {
    const String id = command["id"].as<String>();
    if (id.isEmpty()) continue;

    const String action = command["acao"].as<String>();
    if (action == "exibir_chamada") {
      // Lê os parâmetros enviados pelo painel do atendente
      lastCalledTicket = command["parametros"]["senha"] | "CHAMADA";
      lastCalledDesk   = command["parametros"]["guiche"] | "Guiche 01";

      updateDisplay("CHAMADA ATUAL:", lastCalledTicket, lastCalledDesk);
      playCallSignal();
      confirmCommand(id, true, "Exibido no OLED e sinalizado por som/LED");
    } else {
      confirmCommand(id, false, "Comando nao suportado pelo ESP32");
    }
  }
}

void keepWifiConnected() {
  if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(Pins::LED_ALERT, LOW);
    return;
  }
  digitalWrite(Pins::LED_ALERT, HIGH); // Mantém LED de alerta aceso enquanto offline
  if (millis() - lastWifiRetry < WIFI_RETRY_MS) return;
  lastWifiRetry = millis();
  Serial.println("Tentando reconectar ao Wi-Fi...");
  updateDisplay("CONECTANDO...", "OFFLINE", "Buscando rede Wi-Fi");
  WiFi.reconnect();
}

void setup() {
  Serial.begin(115200);
  storage.begin("e6fila", false);
  sequenceNumber = storage.getULong("sequence", 0);

  commonButton.begin();
  priorityButton.begin();
  repeatButton.begin();

  pinMode(Pins::LED_OK, OUTPUT);
  pinMode(Pins::LED_ALERT, OUTPUT);
  digitalWrite(Pins::LED_OK, LOW);
  digitalWrite(Pins::LED_ALERT, LOW);

  ledcAttach(Pins::BUZZER, BUZZER_FREQ_HZ, BUZZER_RESOLUTION_BITS);

  Wire.begin(Pins::OLED_SDA, Pins::OLED_SCL);
  if (display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    hasOled = true;
    updateDisplay("E6-FILA PRONTO", "AGUARDANDO", "Iniciando Wi-Fi...");
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void loop() {
  keepWifiConnected();

  if (commonButton.wasPressed()) sendButtonEvent("botao_comum");
  if (priorityButton.wasPressed()) sendButtonEvent("botao_prioritaria");
  if (repeatButton.wasPressed()) {
    updateDisplay("REPETINDO:", lastCalledTicket, lastCalledDesk);
    playCallSignal();
  }

  pollCommands();
  delay(10);
}
