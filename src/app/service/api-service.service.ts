import { Injectable, computed, signal } from '@angular/core';

export interface AirPollutant {
  name: string;
  value: number;
  unit: string;
  max?: number;
}

export interface AirQualitySummary {
  aqi: number;
  category: string;
  lastUpdated: string;
  pollutants: AirPollutant[];
}

export interface WeatherSummary {
  temperature: number;
  rain: number;
  rainProbability: number;
  humidity: number;
  rain24h: number;
}

export interface TrafficStreet {
  name: string;
  congestion: number;
}

export interface TrafficSummary {
  overallCongestion: number;
  category: string;
  streets: TrafficStreet[];
}

export interface PollutionHistoryData {
  date: string;
  pm25: number;
  pm10: number;
  no2: number;
  o3?: number;
}

export interface PollutionHeatmapPoint {
  lat: number;
  lng: number;
  value: number;
}

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  // En un proyecto real deberías mover estas claves a variables de entorno
  private readonly aqicnToken = 'TU_TOKEN_AQICN';
  private readonly openWeatherKey = 'TU_API_KEY_OPENWEATHER';

  private readonly airQualitySignal = signal<AirQualitySummary | null>(null);
  private readonly weatherSignal = signal<WeatherSummary | null>(null);
  private readonly trafficSignal = signal<TrafficSummary | null>(null);
  private readonly pollutionHistorySignal = signal<PollutionHistoryData[]>([]);

  readonly airQuality = computed(() => this.airQualitySignal());
  readonly weather = computed(() => this.weatherSignal());
  readonly traffic = computed(() => this.trafficSignal());
  readonly pollutionHistory = computed(() => this.pollutionHistorySignal());

  async loadValenciaData(): Promise<void> {
    await Promise.allSettled([
      this.fetchAirQualityValencia(),
      this.fetchWeatherValencia(),
      this.fetchTrafficValencia(),
    ]);
  }

  async loadPollutionHistory(days: number = 7): Promise<void> {
    await this.fetchPollutionHistoryValencia(days);
  }

  private async fetchAirQualityValencia(): Promise<void> {
    try {
      if (!this.aqicnToken || this.aqicnToken === 'TU_TOKEN_AQICN') {
        // Datos simulados si no hay token
        this.airQualitySignal.set({
          aqi: 67,
          category: 'Moderada',
          lastUpdated: new Date().toLocaleString('es-ES'),
          pollutants: [
            { name: 'PM2.5', value: 45, unit: 'µg/m³' },
            { name: 'PM10', value: 62, unit: 'µg/m³' },
            { name: 'NO₂', value: 38, unit: 'µg/m³' },
            { name: 'O3', value: 72, unit: 'µg/m³' },
          ],
        });
        return;
      }

      const url = `https://api.waqi.info/feed/valencia/?token=${this.aqicnToken}`;
      const res = await fetch(url);
      const json = await res.json();

      const data = json?.data;
      const iaqi = data?.iaqi ?? {};

      const pollutants: AirPollutant[] = [];
      if (iaqi.pm25?.v != null) pollutants.push({ name: 'PM2.5', value: iaqi.pm25.v, unit: 'µg/m³' });
      if (iaqi.pm10?.v != null) pollutants.push({ name: 'PM10', value: iaqi.pm10.v, unit: 'µg/m³' });
      if (iaqi.no2?.v != null) pollutants.push({ name: 'NO₂', value: iaqi.no2.v, unit: 'µg/m³' });

      this.airQualitySignal.set({
        aqi: data?.aqi ?? 0,
        category: data?.dominentpol ?? 'N/D',
        lastUpdated: data?.time?.s ?? new Date().toISOString(),
        pollutants,
      });
    } catch (e) {
      console.error('Error al obtener calidad del aire', e);
    }
  }

  private async fetchWeatherValencia(): Promise<void> {
    try {
      if (!this.openWeatherKey || this.openWeatherKey === 'TU_API_KEY_OPENWEATHER') {
        this.weatherSignal.set({
          temperature: 16,
          rain: 2.4,
          rainProbability: 45,
          humidity: 68,
          rain24h: 8.7,
        });
        return;
      }

      const url = `https://api.openweathermap.org/data/2.5/weather?q=Valencia,ES&units=metric&appid=${this.openWeatherKey}&lang=es`;
      const res = await fetch(url);
      const json = await res.json();

      const rain1h = json?.rain?.['1h'] ?? 0;
      const pop = json?.clouds?.all ?? 0;

      this.weatherSignal.set({
        temperature: json?.main?.temp ?? 0,
        rain: rain1h,
        rainProbability: pop,
        humidity: json?.main?.humidity ?? 0,
        rain24h: json?.rain?.['3h'] ? json.rain['3h'] * 8 : 0, // Estimación aproximada
      });
    } catch (e) {
      console.error('Error al obtener meteo', e);
    }
  }

  private async fetchTrafficValencia(): Promise<void> {
    try {
      // Datos simulados de tráfico
      this.trafficSignal.set({
        overallCongestion: 73,
        category: 'Congestión Alta',
        streets: [
          { name: 'Avenida del Cid', congestion: 85 },
          { name: 'Gran Vía', congestion: 68 },
          { name: 'Blasco Ibáñez', congestion: 52 },
        ],
      });
    } catch (e) {
      console.error('Error al obtener tráfico', e);
    }
  }

  private async fetchPollutionHistoryValencia(days: number = 7): Promise<void> {
    try {
      // Intentar usar OpenAQ API (gratuita, sin token requerido)
      // Buscar estaciones cerca de Valencia: 39.4699, -0.3763
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Primero buscar ubicaciones cerca de Valencia
      const locationsUrl = `https://api.openaq.org/v2/locations?coordinates=39.4699,-0.3763&radius=50000&limit=5`;
      let locationId: string | null = null;
      
      try {
        const locationsRes = await fetch(locationsUrl);
        if (locationsRes.ok) {
          const locationsJson = await locationsRes.json();
          if (locationsJson.results && locationsJson.results.length > 0) {
            // Usar la primera ubicación encontrada
            locationId = locationsJson.results[0].id.toString();
          }
        }
      } catch (e) {
        console.warn('No se pudo obtener ubicaciones de OpenAQ, usando datos simulados', e);
      }

      // Si encontramos una ubicación, obtener mediciones
      if (locationId) {
        const url = `https://api.openaq.org/v2/measurements?location_id=${locationId}&date_from=${startDate.toISOString()}&date_to=${endDate.toISOString()}&limit=1000&parameter=pm25,pm10,no2,o3`;
        
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          
          if (json.results && json.results.length > 0) {
            // Procesar datos de OpenAQ
            const dataByDate = new Map<string, { pm25: number[]; pm10: number[]; no2: number[]; o3: number[] }>();
            
            json.results.forEach((measurement: any) => {
              const date = new Date(measurement.date.utc).toISOString().split('T')[0];
              if (!dataByDate.has(date)) {
                dataByDate.set(date, { pm25: [], pm10: [], no2: [], o3: [] });
              }
              const dayData = dataByDate.get(date)!;
              
              if (measurement.parameter === 'pm25') dayData.pm25.push(measurement.value);
              else if (measurement.parameter === 'pm10') dayData.pm10.push(measurement.value);
              else if (measurement.parameter === 'no2') dayData.no2.push(measurement.value);
              else if (measurement.parameter === 'o3') dayData.o3.push(measurement.value);
            });

            // Convertir a array y calcular promedios diarios
            const history: PollutionHistoryData[] = [];
            dataByDate.forEach((values, date) => {
              history.push({
                date,
                pm25: values.pm25.length > 0 ? values.pm25.reduce((a, b) => a + b, 0) / values.pm25.length : 0,
                pm10: values.pm10.length > 0 ? values.pm10.reduce((a, b) => a + b, 0) / values.pm10.length : 0,
                no2: values.no2.length > 0 ? values.no2.reduce((a, b) => a + b, 0) / values.no2.length : 0,
                o3: values.o3.length > 0 ? values.o3.reduce((a, b) => a + b, 0) / values.o3.length : 0,
              });
            });

            // Ordenar por fecha
            history.sort((a, b) => a.date.localeCompare(b.date));
            
            if (history.length > 0) {
              this.pollutionHistorySignal.set(history);
              return;
            }
          }
        }
      }
      
      // Si no hay datos de OpenAQ, usar datos simulados basados en datos actuales
      this.generateSimulatedHistory(days);

    } catch (e) {
      console.error('Error al obtener historial de contaminación', e);
      // En caso de error, generar datos simulados
      this.generateSimulatedHistory(days);
    }
  }

  private generateSimulatedHistory(days: number): void {
    const history: PollutionHistoryData[] = [];
    const baseValues = { pm25: 45, pm10: 62, no2: 38, o3: 72 };
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      // Variación aleatoria del ±20%
      const variation = () => 0.8 + Math.random() * 0.4;
      
      history.push({
        date: dateStr,
        pm25: Math.round(baseValues.pm25 * variation()),
        pm10: Math.round(baseValues.pm10 * variation()),
        no2: Math.round(baseValues.no2 * variation()),
        o3: Math.round(baseValues.o3 * variation()),
      });
    }
    
    this.pollutionHistorySignal.set(history);
  }

  async fetchPollutionHeatmapValencia(): Promise<PollutionHeatmapPoint[]> {
    try {
      // Coordenadas de estaciones de monitoreo en Valencia (simuladas)
      // Basadas en ubicaciones reales de estaciones de calidad del aire
      const valenciaStations = [
        { lat: 39.4699, lng: -0.3763, name: 'Centro', baseValue: 1.0 },
        { lat: 39.4800, lng: -0.3600, name: 'Burjassot', baseValue: 0.85 },
        { lat: 39.4600, lng: -0.3900, name: 'Quart de Poblet', baseValue: 0.9 },
        { lat: 39.4750, lng: -0.3700, name: 'Poblats Marítims', baseValue: 1.15 },
        { lat: 39.4650, lng: -0.3800, name: 'Eixample', baseValue: 1.1 },
        { lat: 39.4720, lng: -0.3750, name: 'Pla del Real', baseValue: 0.95 },
        { lat: 39.4680, lng: -0.3650, name: 'Ciutat Vella', baseValue: 1.2 },
        { lat: 39.4780, lng: -0.3850, name: 'Campanar', baseValue: 0.88 },
        { lat: 39.4620, lng: -0.3750, name: 'Jesús', baseValue: 1.05 },
        { lat: 39.4700, lng: -0.3500, name: 'Alboraya', baseValue: 0.75 },
        { lat: 39.4550, lng: -0.3800, name: 'Torrent', baseValue: 0.92 },
        { lat: 39.4850, lng: -0.3700, name: 'Godella', baseValue: 0.8 },
        { lat: 39.4750, lng: -0.3900, name: 'Manises', baseValue: 0.95 },
        { lat: 39.4680, lng: -0.3400, name: 'Port Saplatja', baseValue: 0.7 },
        { lat: 39.4600, lng: -0.3600, name: 'Nazaret', baseValue: 1.0 },
        { lat: 39.4720, lng: -0.3650, name: 'Russafa', baseValue: 1.15 },
        { lat: 39.4650, lng: -0.3700, name: 'Benimaclet', baseValue: 0.9 },
        { lat: 39.4800, lng: -0.3750, name: 'Orriols', baseValue: 0.85 }
      ];

      // Obtener datos actuales de calidad del aire
      const airQuality = this.airQualitySignal();
      const pm25Value = airQuality?.pollutants?.find(p => p.name === 'PM2.5')?.value || 45;

      // Generar puntos principales de estaciones
      const mainPoints: PollutionHeatmapPoint[] = valenciaStations.map(station => {
        // Variación determinística basada en la ubicación
        const latSeed = Math.floor(station.lat * 10000) % 50;
        const lngSeed = Math.floor(station.lng * 10000) % 50;
        const variation = station.baseValue * (0.9 + (latSeed + lngSeed) / 100);
        
        return {
          lat: station.lat,
          lng: station.lng,
          value: Math.round(pm25Value * variation)
        };
      });

      // Generar puntos intermedios para crear un heatmap más denso y realista
      const interpolatedPoints: PollutionHeatmapPoint[] = [];
      
      // Interpolar entre estaciones cercanas
      for (let i = 0; i < mainPoints.length; i++) {
        for (let j = i + 1; j < mainPoints.length; j++) {
          const p1 = mainPoints[i];
          const p2 = mainPoints[j];
          
          // Calcular distancia
          const distance = Math.sqrt(
            Math.pow(p1.lat - p2.lat, 2) + Math.pow(p1.lng - p2.lng, 2)
          );
          
          // Solo interpolar si están relativamente cerca (menos de 0.02 grados)
          if (distance < 0.02) {
            // Generar 2-3 puntos intermedios
            const numPoints = Math.floor(2 + Math.random() * 2);
            for (let k = 1; k <= numPoints; k++) {
              const ratio = k / (numPoints + 1);
              const lat = p1.lat + (p2.lat - p1.lat) * ratio;
              const lng = p1.lng + (p2.lng - p1.lng) * ratio;
              const value = p1.value + (p2.value - p1.value) * ratio;
              
              // Añadir pequeña variación
              const variation = 0.85 + Math.random() * 0.3;
              
              interpolatedPoints.push({
                lat: lat + (Math.random() - 0.5) * 0.002,
                lng: lng + (Math.random() - 0.5) * 0.002,
                value: Math.round(value * variation)
              });
            }
          }
        }
      }

      // Generar puntos adicionales alrededor de cada estación principal para cubrir más área
      mainPoints.forEach(point => {
        // Aumentar a 6 puntos alrededor de cada estación para mayor cobertura
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI * 2 * i) / 6;
          const radius = 0.005 + Math.random() * 0.008; // Radio más amplio
          interpolatedPoints.push({
            lat: point.lat + Math.cos(angle) * radius,
            lng: point.lng + Math.sin(angle) * radius,
            value: Math.round(point.value * (0.9 + Math.random() * 0.2))
          });
        }
        // Agregar puntos adicionales en un segundo círculo más amplio
        for (let i = 0; i < 4; i++) {
          const angle = (Math.PI * 2 * i) / 4;
          const radius = 0.010 + Math.random() * 0.010;
          interpolatedPoints.push({
            lat: point.lat + Math.cos(angle) * radius,
            lng: point.lng + Math.sin(angle) * radius,
            value: Math.round(point.value * (0.85 + Math.random() * 0.3))
          });
        }
      });

      // Combinar puntos principales e interpolados
      return [...mainPoints, ...interpolatedPoints];
    } catch (e) {
      console.error('Error al obtener datos del mapa de calor', e);
      // Retornar datos por defecto
      return [
        { lat: 39.4699, lng: -0.3763, value: 45 },
        { lat: 39.4800, lng: -0.3600, value: 42 },
        { lat: 39.4600, lng: -0.3900, value: 48 }
      ];
    }
  }
}
