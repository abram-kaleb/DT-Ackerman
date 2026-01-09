import React, { useEffect, useState } from 'react';
import { InfluxDB } from '@influxdata/influxdb-client';
import { Activity, Thermometer, Droplets, Gauge, Fuel, Clock } from 'lucide-react';

const token = 'SwuZ8PHr5xU6vrLf0eOkSZzmKSZoUfF-I7KHmpfWD_DJTc5Zybm-uwnwHGcTYblJ0OLiWhz14_4E3LivL7NwYQ==';
const org = 'going.merry1331@gmail.com';
const bucket = 'sensor_bucket';
const url = 'https://eu-central-1-1.aws.cloud2.influxdata.com';

const App = () => {
  const [influxData, setInfluxData] = useState({});
  const [lastUpdate, setLastUpdate] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const queryApi = new InfluxDB({ url, token }).getQueryApi(org);
    const fluxQuery = `from(bucket: "${bucket}") |> range(start: -5m) |> filter(fn: (r) => r["_measurement"] == "engine_monitor") |> last()`;

    const fetchData = () => {
      const results = {};
      let timeStamp = null;
      queryApi.queryRows(fluxQuery, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row);
          results[o._field] = o._value;
          if (!timeStamp) timeStamp = o._time;
        },
        complete() {
          if (Object.keys(results).length > 0) {
            setInfluxData(results);
            setLastUpdate(new Date(timeStamp).toLocaleTimeString());
            setLoading(false);
          }
        },
        error(e) {
          console.error("InfluxDB Error:", e);
          setLoading(false);
        }
      });
    };

    const interval = setInterval(fetchData, 2000); // Diperhalus ke 2 detik
    return () => clearInterval(interval);
  }, []);

  const SensorCard = ({ title, value, unit, icon: Icon, color }) => (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon size={24} className="text-white" />
        </div>
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{title}</span>
      </div>
      <div className="flex items-baseline">
        <h2 className="text-3xl font-bold text-gray-800">{value || 0}</h2>
        <span className="ml-1 text-gray-500 font-medium">{unit}</span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans">
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-8 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Engine Health Monitor</h1>
          <p className="text-gray-500 text-sm">Real-time telemetri dari InfluxDB</p>
        </div>
        <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-sm border border-gray-100">
          <Clock size={16} className="text-blue-500" />
          <span className="text-sm font-medium text-gray-600">Last Update: {lastUpdate || 'Connecting...'}</span>
        </div>
      </div>

      {/* Main Grid */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <SensorCard
          title="Rotation Speed"
          value={influxData.rpm}
          unit="RPM"
          icon={Gauge}
          color="bg-blue-500"
        />
        <SensorCard
          title="Engine Load"
          value={influxData.load}
          unit="%"
          icon={Activity}
          color="bg-purple-500"
        />
        <SensorCard
          title="Oil Pressure"
          value={influxData.oil_p}
          unit="PSI"
          icon={Droplets}
          color="bg-red-500"
        />
        <SensorCard
          title="Fuel Rate"
          value={influxData.fuel_rate}
          unit="L/h"
          icon={Fuel}
          color="bg-green-500"
        />
        <SensorCard
          title="Oil Temperature"
          value={influxData.oil_t}
          unit="°C"
          icon={Thermometer}
          color="bg-orange-500"
        />

        {/* Status Card */}
        <div className="bg-gray-800 p-6 rounded-2xl shadow-lg flex flex-col justify-center text-white">
          <h3 className="text-gray-400 text-sm mb-1">System Status</h3>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-xl font-semibold">Operational</span>
          </div>
          <p className="text-xs text-gray-500 mt-4 leading-relaxed">
            All sensors reporting nominal values.
          </p>
        </div>
      </div>
    </div>
  );
};

export default App;