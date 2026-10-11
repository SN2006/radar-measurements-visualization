const SPEED_OF_LIGHT_KM_PER_SECOND = 300000;
const MAX_RANGE_KM = 142;
const TRAIL_TURNS = 5;
const MAX_POINTS = 2000;

const state = {
  socket: null,
  currentAngle: 0,
  currentTurn: 0,
  previousAngle: null,
  points: [],
};

const elements = {
  chart: document.getElementById("radar-chart"),
  connectButton: document.getElementById("connect-button"),
  clearButton: document.getElementById("clear-button"),
  websocketUrl: document.getElementById("websocket-url"),
  connectionStatus: document.getElementById("connection-status"),
  connectionIndicator: document.getElementById("connection-indicator"),
  angleValue: document.getElementById("angle-value"),
  errorMessage: document.getElementById("error-message"),
  configForm: document.getElementById("config-form"),
  loadConfigButton: document.getElementById("load-config-button"),
  configMessage: document.getElementById("config-message"),
};

function initializeChart() {
  const targetTrace = {
    type: "scatterpolar",
    mode: "markers",
    name: "Цілі",
    theta: [],
    r: [],
    customdata: [],
    marker: { size: [], color: [], colorscale: "Turbo", cmin: 0, cmax: 4, opacity: [] },
    hovertemplate: "Кут: %{theta:.1f}°<br>Відстань: %{r:.2f} км<br>Потужність: %{customdata:.2f}<extra></extra>",
  };
  const sweepTrace = {
    type: "scatterpolar",
    mode: "lines",
    name: "Сканування",
    theta: [0, 0],
    r: [0, MAX_RANGE_KM],
    line: { color: "#36d399", width: 2 },
    hoverinfo: "skip",
    showlegend: false,
  };

  Plotly.newPlot(elements.chart, [targetTrace, sweepTrace], {
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    margin: { t: 20, r: 35, b: 35, l: 35 },
    showlegend: true,
    legend: { font: { color: "#b9c8df" }, orientation: "h", x: 0, y: 1.08 },
    font: { color: "#b9c8df" },
    polar: {
      bgcolor: "rgba(7, 17, 31, .7)",
      radialaxis: { range: [0, MAX_RANGE_KM], title: "км", gridcolor: "#29405f", linecolor: "#29405f" },
      angularaxis: { direction: "clockwise", rotation: 90, gridcolor: "#29405f", linecolor: "#29405f" },
    },
  }, { responsive: true, displaylogo: false });
}

function updateChart() {
  const visiblePoints = state.points.filter((point) => state.currentTurn - point.turn <= TRAIL_TURNS);
  const theta = visiblePoints.map((point) => point.angle);
  const range = visiblePoints.map((point) => point.range);
  const power = visiblePoints.map((point) => point.power);
  const opacity = visiblePoints.map((point) => Math.max(.12, 1 - (state.currentTurn - point.turn) / (TRAIL_TURNS + 1)));
  const size = visiblePoints.map((point) => 7 + Math.min(8, Math.log10(1 + point.power) * 2));

  Plotly.restyle(elements.chart, {
    theta: [theta],
    r: [range],
    customdata: [power],
    "marker.opacity": [opacity],
    "marker.size": [size],
  }, [0]);
  Plotly.restyle(elements.chart, { theta: [[state.currentAngle, state.currentAngle]] }, [1]);
  elements.angleValue.textContent = state.currentAngle.toFixed(1);
}

function handleRadarMessage(rawMessage) {
  let message;
  try {
    message = JSON.parse(rawMessage);
  } catch {
    showError("Отримано некоректне JSON-повідомлення.");
    return;
  }

  if (!Number.isFinite(message.scanAngle) || !Array.isArray(message.echoResponses)) {
    showError("Повідомлення не відповідає формату радару.");
    return;
  }

  const angle = ((Number(message.scanAngle) % 360) + 360) % 360;
  if (state.previousAngle !== null && state.previousAngle - angle > 180) state.currentTurn += 1;
  state.previousAngle = angle;
  state.currentAngle = angle;
  message.echoResponses.forEach((echo) => {
    const time = Number(echo.time);
    const power = Number(echo.power);
    if (!Number.isFinite(time) || time < 0 || !Number.isFinite(power)) return;
    state.points.push({
      angle,
      range: SPEED_OF_LIGHT_KM_PER_SECOND * time / 2,
      power,
      turn: state.currentTurn,
    });
  });
  if (state.points.length > MAX_POINTS) state.points.splice(0, state.points.length - MAX_POINTS);
  elements.errorMessage.textContent = "";
  updateChart();
}

function setConnectionState(connected, status) {
  elements.connectionIndicator.classList.toggle("online", connected);
  elements.connectionIndicator.classList.toggle("offline", !connected);
  elements.connectionStatus.textContent = status;
  elements.connectButton.textContent = connected ? "Відключитися" : "Підключитися";
}

function showError(message) {
  elements.errorMessage.textContent = message;
}

function connect() {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.close();
    return;
  }
  const url = elements.websocketUrl.value.trim();
  if (!url) {
    showError("Вкажіть WebSocket URL.");
    return;
  }
  setConnectionState(false, "Підключення...");
  showError("");
  try {
    state.socket = new WebSocket(url);
  } catch {
    setConnectionState(false, "Помилка");
    showError("Не вдалося створити WebSocket-з'єднання.");
    return;
  }
  state.socket.addEventListener("open", () => setConnectionState(true, "Підключено"));
  state.socket.addEventListener("message", (event) => handleRadarMessage(event.data));
  state.socket.addEventListener("error", () => showError("Помилка WebSocket-з'єднання."));
  state.socket.addEventListener("close", () => {
    setConnectionState(false, "Відключено");
    state.socket = null;
  });
}

function clearTrail() {
  state.points = [];
  state.currentTurn = 0;
  state.previousAngle = null;
  updateChart();
}

function getApiUrl() {
  return elements.websocketUrl.value.trim().replace(/^ws/, "http");
}

function setConfig(config) {
  ["measurementsPerRotation", "rotationSpeed", "numberOfTargets", "targetSpeed"].forEach((name) => {
    const input = elements.configForm.elements[name];
    if (config[name] !== undefined) input.value = config[name];
  });
}

async function loadConfig() {
  elements.configMessage.textContent = "Завантаження...";
  try {
    const response = await fetch(`${getApiUrl()}/config`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    setConfig(result);
    elements.configMessage.textContent = "Параметри завантажено.";
  } catch (error) {
    elements.configMessage.textContent = `Помилка: ${error.message}`;
  }
}

async function updateConfig(event) {
  event.preventDefault();
  const formData = new FormData(elements.configForm);
  const config = Object.fromEntries([...formData.entries()].map(([key, value]) => [key, Number(value)]));
  elements.configMessage.textContent = "Збереження...";
  try {
    const response = await fetch(`${getApiUrl()}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    setConfig(result);
    elements.configMessage.textContent = "Параметри застосовано.";
  } catch (error) {
    elements.configMessage.textContent = `Помилка: ${error.message}`;
  }
}

elements.connectButton.addEventListener("click", connect);
elements.clearButton.addEventListener("click", clearTrail);
elements.loadConfigButton.addEventListener("click", loadConfig);
elements.configForm.addEventListener("submit", updateConfig);
window.addEventListener("load", initializeChart);
