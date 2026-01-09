import React, { useState, useEffect, useCallback, useRef } from 'react';
import { InfluxDB } from '@influxdata/influxdb-client-browser';
import GaugeComponent from 'react-gauge-component';
import Draggable from 'react-draggable';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

import mqtt from 'mqtt';

// === KONFIGURASI KONEKSI ===
const token = process.env.REACT_APP_INFLUX_TOKEN;
const org = process.env.REACT_APP_INFLUX_ORG;
const bucket = process.env.REACT_APP_INFLUX_BUCKET;
const url = process.env.REACT_APP_INFLUX_URL;

const blinkerCSS = `

@keyframes blinker {
    0% { background-color: #rgba(0, 0, 0, 1); }
    50% { background-color: #ff0000; }
    100% { background-color: #rgba(0, 81, 255, 1); }
  }

  .alarm-blink {
    animation: blinker 1s linear infinite !important;
  }

  /* ... kode blinker yang sudah ada ... */

  /* Garis Slider (Chrome, Safari, Edge, Opera) */
  input[type=range] {
    -webkit-appearance: none;
    background: transparent;
  }

  input[type=range]::-webkit-slider-runnable-track {
    width: 100%;
    height: 4px;
    background: #00d4ff; /* WARNA GARIS SLIDER */
    border-radius: 2px;
    box-shadow: 0 0 5px rgba(0, 212, 255, 0.5);
  }

  /* Lingkaran Penarik (Thumb) */
  input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none;
    height: 16px;
    width: 16px;
    border-radius: 50%;
    background: #ffffff;
    cursor: pointer;
    margin-top: -6px; /* Menyelaraskan dengan garis */
    box-shadow: 0 0 10px rgba(0, 212, 255, 0.8);
  }

  /* Garis Slider untuk Firefox */
  input[type=range]::-moz-range-track {
    width: 100%;
    height: 4px;
    background: #00d4ff;
    border-radius: 2px;
  }
`;

const App = () => {

  const sendControl = (param, value) => {
    if (mqttClient && mqttClient.connected) {
      const topic = `merry_1331_man_engine/cmd/${param}`;
      mqttClient.publish(topic, value.toString());
      console.log(`Command Sent: ${topic} -> ${value}`);
    } else {
      console.error("MQTT not connected");
    }
  };


  const handleSet = (type, value) => {
    sendControl(type, value);
    setIsSyncing(true);
    setTimeout(() => setIsSyncing(false), 3000);
  };

  const [hoverBtn, setHoverBtn] = useState(null); // 'rpm', 'load', atau null 
  const [hoverExpand, setHoverExpand] = useState(false);

  const [localRPM, setLocalRPM] = useState(400);
  const [localLoad, setLocalLoad] = useState(20);
  const [, setIsSyncing] = useState(false);

  const [data, setData] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedField, setSelectedField] = useState('rpm');
  const [timeRange, setTimeRange] = useState('-1h');
  const [alarms, setAlarms] = useState([]);
  const [connStatus, setConnStatus] = useState('CONNECTION LOST');
  const [showExhDetail, setShowExhDetail] = useState(false);
  const [isTrendMaximized, setIsTrendMaximized] = useState(false);

  const rpmRef = useRef(null);
  const loadRef = useRef(null);
  const paramRef = useRef(null);
  const histRef = useRef(null);
  const alarmRef = useRef(null);


  // Tambahkan state flag di bagian atas
  const [hasInitialSync, setHasInitialSync] = useState(false);

  useEffect(() => {
    // Jika data sudah masuk dan kita belum melakukan sinkronisasi awal
    if (data && !hasInitialSync) {
      if (data.rpm) setLocalRPM(Math.round(data.rpm));
      if (data.load) setLocalLoad(Math.round(data.load));

      setHasInitialSync(true); // Kunci agar tidak sinkronisasi ulang terus-menerus
      console.log("Initial slider sync completed with live data");
    }
  }, [data, hasInitialSync]);


  const [zIndex, setZIndex] = useState({ rpm: 1, load: 1, params: 1, hist: 1, alarm: 1, control: 1 });
  const bringToFront = (id) => setZIndex(prev => ({ ...prev, [id]: Math.max(...Object.values(prev)) + 1 }));
  const clearAlarm = (id) => setAlarms(prev => prev.filter(a => a.id !== id));

  const fetchData = useCallback(() => {
    const queryApi = new InfluxDB({ url, token }).getQueryApi(org);
    const fluxQuery = `from(bucket: "${bucket}") |> range(start: -1m) |> filter(fn: (r) => r["_measurement"] == "engine_monitor") |> last() |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")`;

    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        setData(o);
        setConnStatus('ONLINE');
        const detected = [];
        if (o.oil_p < 2.5) detected.push({ id: 'oil_p', msg: 'LOW LUBE OIL PRESS', sev: 'HIGH' });
        if (o.rpm > 900) detected.push({ id: 'rpm_high', msg: 'ENGINE OVERSPEED', sev: 'CRITICAL' });
        if (o.load > 90) detected.push({ id: 'load_high', msg: 'HIGH ENGINE LOAD', sev: 'HIGH' });

        setAlarms(prev => {
          const existingIds = prev.map(a => a.id);
          const filteredNew = detected.filter(a => !existingIds.includes(a.id));
          return [...prev, ...filteredNew];
        });
      },
      error() { setConnStatus('OFFLINE'); },
      complete() { setTimeout(fetchData, 1000); },
    });
  }, []);

  const fetchHistory = useCallback(() => {
    setLoadingHistory(true);
    const queryApi = new InfluxDB({ url, token }).getQueryApi(org);

    // Logika pembagian waktu (Agregasi)
    let windowPeriod = '1m';
    if (timeRange === '-5m') windowPeriod = '10s';
    else if (timeRange === '-24h') windowPeriod = '15m';
    else if (timeRange === '-7d') windowPeriod = '2h';
    else if (timeRange === '-30d') windowPeriod = '6h'; // Satu bulan diwakili titik data per 6 jam

    const fluxQuery = `from(bucket: "${bucket}") 
    |> range(start: ${timeRange}) 
    |> filter(fn: (r) => r["_measurement"] == "engine_monitor") 
    |> filter(fn: (r) => r["_field"] == "${selectedField}") 
    |> aggregateWindow(every: ${windowPeriod}, fn: mean, createEmpty: false)`;

    const results = [];
    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        // Format waktu disesuaikan: Jika 30 hari, tampilkan Tanggal dan Jam
        const dateObj = new Date(o._time);
        const timeLabel = timeRange === '-30d' || timeRange === '-7d'
          ? `${dateObj.getDate()}/${dateObj.getMonth() + 1} ${dateObj.getHours()}:00`
          : dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        results.push({
          time: timeLabel,
          value: o._value
        });
      },
      error() { setLoadingHistory(false); },
      complete() { setHistoryData(results); setLoadingHistory(false); },
    });
  }, [selectedField, timeRange]);

  useEffect(() => {

    const client = mqtt.connect('wss://broker.emqx.io:8084/mqtt');
    client.on('connect', () => {
      console.log('Connected to MQTT Broker');
      setMqttClient(client);
    });

    client.on('error', (err) => {
      console.error('MQTT Connection Error: ', err);
      client.end();
    });

    const styleSheet = document.createElement("style");
    styleSheet.innerText = blinkerCSS;
    document.head.appendChild(styleSheet);
    fetchData();
    fetchHistory();
  }, [fetchData, fetchHistory]);

  const [mqttClient, setMqttClient] = useState(null);
  const controlRef = useRef(null); // Ref untuk jendela kontrol

  return (
    <div style={containerStyle}>
      <img
        src="https://i.postimg.cc/50w0qt8m/Adobe-Express-file.png"
        alt="Engine Background"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '48vw',
          opacity: '1', // Sangat tipis agar tidak mengganggu pembacaan data
          zIndex: 0,
          pointerEvents: 'none',
          userSelect: 'none'
        }}
      />
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1vw', color: '#fff' }}> {/* Paksa warna putih di sini */}
          {/* Jam dan Tanggal */}
          <div style={{ textAlign: 'left', borderRight: '1px solid rgba(255,255,255,0.2)', paddingRight: '1vw' }}>
            <div style={{ fontSize: '1.1vw', fontWeight: '900', lineHeight: '1', color: '#ffffff' }}>
              {data ? new Date(data._time).toLocaleTimeString([], { hour12: false }) : '--:--:--'}
            </div>
            <div style={{ fontSize: '0.65vw', color: '#aaa', marginTop: '2px' }}> {/* Tanggal pakai abu terang agar tidak kontras tinggi */}
              {data ? new Date(data._time).toLocaleDateString() : '---'}
            </div>
          </div>

          {/* Judul Mesin */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '1.1vw', fontWeight: '900', color: '#fff', letterSpacing: '1px' }}>MAN 5LYY/30H</span>
            <span style={{ fontSize: '0.55vw', color: '#00d4ff', fontWeight: 'bold' }}>PROPULSION MONITORING UNIT</span>
          </div>
        </div>

        {/* Bagian Kanan (v2.1_ackerman) */}
        <div style={{ textAlign: 'right', color: '#fff' }}> {/* Tambahkan color: #fff */}
          <div style={{ fontSize: '1.1vw', fontWeight: '900', color: '#ffffff' }}>v2.2_ackerman</div>
          <div style={{ fontSize: '0.8vw', color: connStatus === 'ONLINE' ? '#00ff41' : '#ff4444', fontWeight: 'bold' }}>{connStatus}</div>
        </div>
      </header>


      <main style={mainAreaStyle}>

        {/* ENGINE CONTROL WINDOW */}
        <Draggable nodeRef={controlRef} handle=".drag-bar" onStart={() => bringToFront('control')}>
          <div ref={controlRef} style={{ ...windowStyle, minheight: '22vw', width: '18vw', zIndex: zIndex.control }}>
            <div className="drag-bar" style={{ ...dragBarStyle, buttomlineborder: '1px solid rgba(255, 255, 255, 1)', backgroundColor: '#00000011' }}>
              <span style={titleStyle}>REMOTE CONTROL CENTER</span>
            </div>


            <div style={{ padding: '1vw', display: 'flex', flexDirection: 'column', gap: '1.2vw' }}>

              {/* RPM SLIDER */}
              <div style={{ borderBottom: '1px solid #333', pb: '1vw' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', mb: '5px' }}>
                  <span style={{ color: '#00d4ff', fontSize: '0.7vw' }}>RPM SETPOINT</span>
                  <span style={{ color: '#fff', fontWeight: 'bold' }}>{localRPM}</span>
                </div>

                <input
                  type="range" min="400" max="1000" step="1"
                  value={localRPM}
                  onChange={(e) => setLocalRPM(parseInt(e.target.value))}
                  style={sliderStyle}
                />
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px' }}>
                  <button
                    onMouseEnter={() => setHoverBtn('rpm')}
                    onMouseLeave={() => setHoverBtn(null)}
                    onClick={() => handleSet('rpm', localRPM)}
                    style={{
                      ...loadBtn,
                      flex: 1,
                      py: '5px',
                      fontSize: '0.7vw',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      // Efek Hover
                      backgroundColor: hoverBtn === 'rpm' ? '#00d4ff' : '#1a4a4a',
                      color: hoverBtn === 'rpm' ? '#000' : '#fff',
                      boxShadow: hoverBtn === 'rpm' ? '0 0 15px #00d4ffaa' : 'none',
                      // border: hoverBtn === 'rpm' ? '1px solid #fff' : '1px solid transparent'
                    }}
                  >
                    SET RPM
                  </button>


                  {/* Indikator Proses */}

                  {Math.abs((data?.rpm || 0) - localRPM) > 2 ? (
                    <span style={{
                      color: '#ffaa00',
                      fontSize: '0.65vw',
                      fontFamily: 'monospace',
                      animation: 'blink 1s infinite'
                    }}>
                      ● SYNCING TO {localRPM}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* LOAD SLIDER */}
              <div style={{ borderBottom: '1px solid #333', pb: '1vw' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', mb: '5px' }}>
                  <span style={{ color: '#00d4ff', fontSize: '0.7vw' }}>LOAD SETPOINT</span>
                  <span style={{ color: '#fff', fontWeight: 'bold' }}>{localLoad}</span>
                </div>

                <input
                  type="range" min="0" max="100" step="1"
                  value={localLoad}
                  onChange={(e) => setLocalLoad(parseInt(e.target.value))}
                  style={sliderStyle}
                />
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px' }}>
                  <button
                    onMouseEnter={() => setHoverBtn('load')}
                    onMouseLeave={() => setHoverBtn(null)}
                    onClick={() => handleSet('load', localLoad)}
                    style={{
                      ...loadBtn,
                      width: '100%',
                      mt: '10px',
                      py: '5px',
                      fontSize: '0.7vw',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      // Efek Hover
                      backgroundColor: hoverBtn === 'load' ? '#00d4ff' : '#1a4a4a',
                      color: hoverBtn === 'load' ? '#000' : '#fff',
                      boxShadow: hoverBtn === 'load' ? '0 0 15px #00d4ffaa' : 'none',
                      // border: hoverBtn === 'load' ? '1px solid #fff' : '1px solid transparent'
                    }}
                  >
                    SET LOAD
                  </button>
                  {/* Indikator Proses */}

                  {Math.abs((data?.load || 0) - localLoad) > 2 ? (
                    <span style={{
                      color: '#ffaa00',
                      fontSize: '0.65vw',
                      fontFamily: 'monospace',
                      animation: 'blink 1s infinite'
                    }}>
                      ● SYNCING TO {localLoad}
                    </span>
                  ) : null}
                </div>
              </div>


              <button
                onMouseEnter={() => setHoverBtn('emergency')}
                onMouseLeave={() => setHoverBtn(null)}
                onClick={() => {
                  // 1. Kirim perintah ke Python via MQTT
                  handleSet('rpm', 400);
                  handleSet('load', 0);

                  // 2. Paksa slider visual bergerak ke posisi aman
                  setLocalRPM(400);
                  setLocalLoad(0);

                  console.warn("EMERGENCY IDLE ACTIVATED: Resetting to 400 RPM / 0% Load");
                }}
                style={{
                  ...loadBtn,
                  backgroundColor: hoverBtn === 'emergency' ? '#ff0000' : '#1a4a4a',
                  color: '#00d4ff',
                  marginTop: '0.5vw',
                  fontSize: '15px',
                  width: '100%',
                  fontWeight: 'bold',
                  // border: '2px solid #ff4444',
                  boxShadow: hoverBtn === 'emergency' ? '0 0 20px #ff0000' : 'none',
                  transition: 'all 0.3s ease',
                  cursor: 'pointer'
                }}
              >
                <i className="fas fa-exclamation-triangle"></i> EMERGENCY IDLE
              </button>
            </div>
          </div>
        </Draggable>




        <div style={leftStackStyle}>
          {/* ENGINE SPEED GAUGE - RESPONSIVE */}
          <Draggable nodeRef={rpmRef} handle=".drag-bar" onStart={() => bringToFront('rpm')}>
            <div ref={rpmRef} style={{ ...windowStyle, width: '18vw', zIndex: zIndex.rpm, animation: (data?.rpm > 900) ? 'blinker 1s linear infinite' : 'none' }}>
              <div className="drag-bar" style={dragBarStyle}><span style={titleStyle}>ENGINE SPEED</span></div>
              <div style={{ ...contentStyle, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ marginBottom: '-1vw', textAlign: 'center', zIndex: 2 }}>
                  <span style={{ fontSize: '2vw', fontWeight: '900', color: '#00d4ff' }}>{data?.rpm || 0}</span>
                  <span style={{ fontSize: '0.8vw', color: '#00d4ff', marginLeft: '0.3vw' }}>RPM</span>
                </div>
                <div style={{ width: '100%' }}>
                  <GaugeComponent
                    style={{ width: '100%' }}
                    value={data?.rpm || 0}
                    maxValue={1000}
                    type="radial"
                    arc={{
                      width: 0.15,
                      padding: 0.02,
                      subArcs: [
                        { limit: 900, color: '#00d4ff' }, // Area Hijau (Wajar)
                        { limit: 1000, color: '#EA4228' } // Area Merah (Batas Atas)
                      ]
                    }}
                    pointer={{ type: "needle", color: "#ffffff", baseColor: "#ffffff", width: 15 }}
                    labels={{
                      valueLabel: { hide: true },
                      tickLabels: {
                        type: "outer",
                        hideMinMax: false,
                        ticks: [
                          { value: 0 }, { value: 400 },
                          { value: 900 }, { value: 1000 }
                        ],
                        defaultTickValueConfig: {
                          style: { fill: "#ffffff", fontSize: "10px" } // Memastikan angka putih
                        }
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          </Draggable>

          {/* ENGINE LOAD GAUGE - RESPONSIVE */}
          <Draggable nodeRef={loadRef} handle=".drag-bar" onStart={() => bringToFront('load')}>
            <div ref={loadRef} style={{ ...windowStyle, width: '18vw', zIndex: zIndex.load, animation: (data?.load > 90) ? 'blinker 1s linear infinite' : 'none' }}>
              <div className="drag-bar" style={dragBarStyle}><span style={titleStyle}>ENGINE LOAD</span></div>
              <div style={{ ...contentStyle, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

                {/* UPDATE DI SINI: Menggunakan toFixed(2) untuk angka digital di tengah */}
                <div style={{ marginBottom: '-1vw', textAlign: 'center', zIndex: 2 }}>
                  <span style={{ fontSize: '2vw', fontWeight: '900', color: '#00d4ff' }}>
                    {data?.load ? data.load.toFixed(2) : "0.00"}
                  </span>
                  <span style={{ fontSize: '0.8vw', color: '#ffffffff', marginLeft: '0.3vw' }}>%</span>
                </div>

                <div style={{ width: '100%' }}>
                  <GaugeComponent
                    style={{ width: '100%' }}
                    value={data?.load || 0}
                    type="semicircle"
                    arc={{
                      width: 0.15,
                      padding: 0.02,
                      subArcs: [
                        { limit: 90, color: '#00d4ff' }, // Beban Normal
                        { limit: 100, color: '#EA4228' } // Beban Kritis
                      ]
                    }}
                    pointer={{ type: "needle", color: "#ffffff", baseColor: "#ffffff", width: 15 }}
                    labels={{
                      valueLabel: { hide: true },
                      tickLabels: {
                        type: "outer",
                        ticks: [
                          { value: 90 }, { value: 100 }
                        ],
                        defaultTickValueConfig: {
                          style: { fill: "#ffffff", fontSize: "10px" }
                        }
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          </Draggable>
        </div>

        <div style={rightStackStyle}>
          <Draggable nodeRef={alarmRef} handle=".drag-bar" onStart={() => bringToFront('alarm')}>
            <div ref={alarmRef} style={{ ...windowStyle, width: '18vw', zIndex: zIndex.alarm }}>
              <div className="drag-bar" style={{ ...dragBarStyle, backgroundColor: alarms.length > 0 ? '#ff0000ff' : '#1a1a1a' }}>
                <span style={titleStyle}>ALARM ({alarms.length})</span>
              </div>
              <div style={{ padding: '0.6vw', maxHeight: '10vh', overflowY: 'auto' }}>
                {alarms.length === 0 ? <div style={{ fontSize: '0.8vw', textAlign: 'center', color: '#ffffffff', padding: '0.5vw' }}>SYSTEM NORMAL</div> :
                  alarms.map(a => <div key={a.id} style={alarmBoxSlim}><span>[ {a.sev} ] {a.msg}</span><button onClick={() => clearAlarm(a.id)} style={clearBtn}>ACK</button></div>)
                }
              </div>
            </div>
          </Draggable>

          <Draggable nodeRef={paramRef} handle=".drag-bar" onStart={() => bringToFront('params')}>
            <div ref={paramRef} style={{ ...windowStyle, width: '18vw', zIndex: zIndex.params }}>
              <div className="drag-bar" style={dragBarStyle}><span style={titleStyle}>SYSTEM PARAMETERS</span></div>
              <div style={{ padding: '0.8vw' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8vw', marginBottom: '1vw' }}>

                  <div><div style={categoryLabel}>FUEL RATE</div><TextVal val={data?.fuel_rate} unit="kg/h" large /></div>
                  <div onClick={() => setShowExhDetail(!showExhDetail)} style={{ cursor: 'pointer' }}><div style={categoryLabel}>EXH GAS AVG {showExhDetail ? '▴' : '▾'}</div><TextVal val={data?.exh_t_avg} unit="°C" large /></div>
                </div>
                {showExhDetail && (
                  <div style={exhGrid}>
                    <TextVal label="C1" val={data?.exh_t_c1} unit="" mini /><TextVal label="C2" val={data?.exh_t_c2} unit="" mini /><TextVal label="C3" val={data?.exh_t_c3} unit="" mini />
                    <TextVal label="C4" val={data?.exh_t_c4} unit="" mini /><TextVal label="C5" val={data?.exh_t_c5} unit="" mini /><TextVal label="C6" val={data?.exh_t_c6} unit="" mini />
                  </div>
                )}
                <div style={categoryLabel}>PRESSURE</div>
                <div style={textGrid}><TextVal label="LUBE" val={data?.oil_p} unit="Bar" /><TextVal label="BOOST" val={data?.boost_p} unit="Bar" /><TextVal label="SW" val={data?.sw_p} unit="Bar" /></div>
                <div style={{ ...categoryLabel, marginTop: '1vw' }}>TEMPERATURE</div>
                <div style={textGrid}><TextVal label="OIL" val={data?.oil_t} unit="°C" /><TextVal label="CW" val={data?.cw_t} unit="°C" /></div>
              </div>
            </div>
          </Draggable>

          <Draggable nodeRef={histRef} handle=".drag-bar" onStart={() => bringToFront('hist')}>
            <div ref={histRef} style={{ ...windowStyle, width: '18vw', zIndex: zIndex.hist }}>
              <div className="drag-bar" style={dragBarStyle}>
                <span style={titleStyle}>TREND: {selectedField.toUpperCase()}</span>

                <button
                  onMouseEnter={() => setHoverExpand(true)}
                  onMouseLeave={() => setHoverExpand(false)}
                  onClick={() => setIsTrendMaximized(true)}
                  style={{
                    ...loadBtn,
                    backgroundColor: hoverExpand ? '#00d4ff' : '#1a4a4a',
                    color: hoverExpand ? '#000' : '#fff',
                    boxShadow: hoverExpand ? '0 0 15px #00d4ffaa' : 'none',
                    border: hoverExpand ? '1px solid #fff' : '1px solid transparent',
                    transition: 'all 0.2s ease',
                    cursor: 'pointer'
                  }}
                >
                  EXPAND
                </button>

              </div>
              <div style={{ height: '14vh', padding: '0.5vw' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyData}>
                    <CartesianGrid stroke="#5e5e5eff" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="time" hide />
                    <YAxis fontSize="0.6vw" stroke="#747474ff" domain={['auto', 'auto']} width={25} />
                    <Line type="monotone" dataKey="value" stroke="#00d4ff" dot={false} strokeWidth={2} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Draggable>
        </div>
      </main>

      {
        isTrendMaximized && (
          <div style={fullScreenOverlay}>
            <div style={{
              ...windowStyle,
              width: '70vw',
              height: '90vh',
              backgroundColor: 'rgba(10, 10, 10, 0.4)', // Diubah dari hitam pekat ke transparan
              backdropFilter: 'blur(15px)',           // Efek blur agar tetap kontras
              border: '1px solid rgba(255,255,255,0.1)'
            }}>
              <div style={dragBarStyle}>
                <span style={{ fontSize: '1.2vw', fontWeight: 'bold' }}>DETAILED TREND ANALYSIS</span>
                <div style={{ display: 'flex', gap: '0.8vw' }}>
                  <select value={selectedField} onChange={e => setSelectedField(e.target.value)} style={selectStyle}>
                    <option value="rpm">SPEED (RPM)</option><option value="load">LOAD (%)</option>
                    <option value="fuel_rate">FUEL (kg/h)</option><option value="oil_p">OIL PRESS (Bar)</option>
                  </select>
                  <select value={timeRange} onChange={e => setTimeRange(e.target.value)} style={selectStyle}>
                    <option value=
                      "-5m">LATEST 5 MIN</option><option value=
                        "-15m">LATEST 15 MIN</option><option value=
                          "-1h">LATEST 1 HOUR</option><option value=
                            "-24h">LATEST 24 HOUR</option>
                    <option value="-7d">LATEST 7 DAYS</option>
                    <option value="-30d">LATEST 30 DAYS</option>
                  </select>
                  <button onClick={fetchHistory} style={loadBtn}>{loadingHistory ? 'LOADING...' : 'REFRESH'}</button>
                  <button onClick={() => setIsTrendMaximized(false)} style={{ ...loadBtn, backgroundColor: '#ff4444' }}>EXIT</button>
                </div>
              </div>
              <div style={{ height: '75vh', padding: '2vw' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyData}>
                    <CartesianGrid stroke="#222" strokeDasharray="3 3" />
                    <XAxis dataKey="time" stroke="#666" fontSize="0.8vw" />
                    <YAxis stroke="#666" fontSize="0.8vw" domain={['auto', 'auto']} width={40} />
                    <Tooltip contentStyle={{ backgroundColor: '#000', border: '1px solid #00d4ff' }} />
                    <Line type="monotone" dataKey="value" stroke="#00d4ff" strokeWidth={3} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )
      }

      <footer style={footerStyle}>
        <div style={footerLine}></div>
        <div style={footerContent}>
          <span>Engineered By <strong style={{ color: '#aaa' }}>Martua_Manulang</strong></span>
          <span style={{ opacity: 0.8 }}>© 2026 DIGITAL TWIN FRAMEWORK PROTOTYPE • ALL RIGHTS RESERVED</span>
        </div>
      </footer>


    </div >
  );
};

const TextVal = ({ label, val, unit, large, mini }) => (
  <div style={{ color: '#00d4ff' }}> {/* Paksa warna putih di sini */}
    {label && <div style={{ fontSize: mini ? '0.5vw' : '0.6vw', color: '#888', fontWeight: 'bold' }}>{label}</div>}
    <div style={{ fontSize: large ? '1.8vw' : mini ? '1vw' : '1.3vw', fontWeight: '900', lineHeight: '1.1' }}>
      {val?.toFixed(1) || '0.0'}
      <span style={{ fontSize: '0.7vw', color: '#00d4ff', marginLeft: '2px' }}>{unit}</span>
    </div>
  </div>
);

const containerStyle = {
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  backgroundColor: '#052d38', // Warna dasar gelap
  backgroundImage: `
    radial-gradient(circle at center, rgba(0, 212, 255, 0.15) 0%, transparent 50%), 
    radial-gradient(rgba(255, 255, 255, 0.06) 0.1px, transparent 3px)
  `,
  backgroundSize: '100% 100%, 35px 35px',
  backgroundAttachment: 'fixed'
};

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '1vw 2vw',
  borderBottom: '1px solid rgba(255,255,255,0.1)',
  backgroundColor: 'rgba(0, 0, 0, 0)', // Semi transparan
  backdropFilter: 'blur(0px)' // Efek blur latar belakang
};


const mainAreaStyle = { display: 'flex', justifyContent: 'space-between', padding: '1.5vw', flexGrow: 1 };
const leftStackStyle = { display: 'flex', flexDirection: 'column', gap: '2vh' };
const rightStackStyle = { display: 'flex', flexDirection: 'column', gap: '1.5vh', alignItems: 'flex-end' };

const windowStyle = {
  backgroundColor: 'rgba(0, 0, 0, 0.3)', // Lebih transparan agar BG terlihat
  backdropFilter: 'blur(30px)',
  borderRadius: '22px',
  border: '2px solid #85858511',
  boxShadow: '0 4px 30px rgba(0, 0, 0, 0.13)',
  width: '18vw',
  minWidth: '250px',
  height: 'fit-content', // Tinggi mengikuti isi konten, bukan ukuran layar
  flexShrink: 0,         // Mencegah window "gepeng" saat kontainer menyempit

};

const dragBarStyle = {
  backgroundColor: '#18181804', // Warna aksen hitam solid
  padding: '0.6vw 1vw',
  borderRadius: '20px',
  // borderBottom: '1px solid rgba(255,255,255,0.1)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  cursor: 'grab'
};

const titleStyle = { fontSize: '0.90vw', fontWeight: 'bold', color: '#eee' };
const contentStyle = { padding: '1vw' };

const categoryLabel = {
  fontSize: '0.8vw',
  color: '#ffffffff',
  fontWeight: 'bold',
  borderBottom: '1px solid rgba(0,212,255,0.3)',
  marginBottom: '0.5vw'
};

const textGrid = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.8vw' };

const exhGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '0.5vw',
  marginTop: '0.5vw',
  padding: '0.5vw',
  backgroundColor: 'rgba(0,0,0,0.5)',
  borderRadius: '8px'
};

const alarmBoxSlim = {
  backgroundColor: 'rgba(255, 0, 0, 0.15)',
  borderLeft: '3px solid #ff4444',
  padding: '0.4vw 0.8vw',
  marginBottom: '0.4vw',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: '0.8vw',
  color: '#ff4444'
};


const sliderStyle = {
  appearance: 'none',
  width: '100%',
  height: '8px',
  background: '#000000ff',
  borderRadius: '4px',
  outline: 'none',
  // border: '1px solid #00d4ff33',
  boxShadow: 'inset 0 0 5px #000',
  marginTop: '10px',
  marginBottom: '10px',
  cursor: 'pointer'
};

const clearBtn = { backgroundColor: '#440000', border: '1px solid #f00', color: '#fff', cursor: 'pointer', fontSize: '0.55vw', padding: '0.2vw 0.5vw' };
const selectStyle = { backgroundColor: '#000', color: '#00d4ff', fontSize: '0.8vw', border: '1px solid #444', borderRadius: '4px', padding: '2px 5px' };
const loadBtn = { backgroundColor: '#00d4ff', border: 'none', padding: '0.3vw 0.8vw', fontSize: '0.7vw', fontWeight: '900', cursor: 'pointer', borderRadius: '4px' };
const fullScreenOverlay = { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' };

const footerStyle = {
  padding: '0.5vw 2vw',
  backgroundColor: 'rgba(0, 0, 0, 0)', // Semi transparan
  backdropFilter: 'blur(0px)', // Efek blur latar belakang
  zIndex: 10,
};

const footerLine = {
  height: '1px',
  background: 'linear-gradient(90deg, transparent, rgba(0,212,255,0.3), transparent)',
  marginBottom: '0.5vw'
};

const footerContent = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: '0.65vw',
  color: '#aaa',
  letterSpacing: '1px'
};




export default App;
