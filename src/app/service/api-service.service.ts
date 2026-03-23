import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

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
  dataSource?: 'real' | 'simulated';
  sourceName?: string;
  locationName?: string;
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
  location?: string; // Nombre del barrio/zona
  address?: string;  // Dirección opcional
}

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  // En un proyecto real deberías mover estas claves a variables de entorno
  private readonly aqicnToken = '/api.waqi.info/feed/here/?token=041a4eeeb23d0664c5486010da80c847e5cbb3b5';
  private readonly openWeatherKey = '/api.openweathermap.org/data/2.5/weather?q=Valencia,ES&units=metric&appid=91cf68f7f32d876ccbcce3f0b3bcd63a';
  private readonly http = inject(HttpClient);
  private readonly airQualitySignal = signal<AirQualitySummary | null>(null);
  private readonly weatherSignal = signal<WeatherSummary | null>(null);
  private readonly trafficSignal = signal<TrafficSummary | null>(null);
  private readonly pollutionHistorySignal = signal<PollutionHistoryData[]>([]);
  private readonly selectedDateSignal = signal<string>(new Date().toISOString().split('T')[0]);

  readonly airQuality = computed(() => this.airQualitySignal());
  readonly weather = computed(() => this.weatherSignal());
  readonly traffic = computed(() => this.trafficSignal());
  readonly pollutionHistory = computed(() => this.pollutionHistorySignal());
  readonly selectedDate = computed(() => this.selectedDateSignal());

  setSelectedDate(date: string): void {
    this.selectedDateSignal.set(date);
  }

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
    const targetDate = this.selectedDateSignal();
    const now = new Date();
    const todayStr = new Date().toISOString().split('T')[0];
    const isToday = targetDate === todayStr;
    const isFuture = targetDate > todayStr;

    if (isFuture) {
      this.airQualitySignal.set(null);
      return;
    }

    try {
      // Paso 1: Buscar estaciones en Valencia usando v3
      const locUrl = `/api/v3/locations?coordinates=39.4699,-0.3763&radius=25000&limit=10`;
      const locJson: any = await this.http.get(locUrl).toPromise().catch(() => null);

      if (locJson?.results?.length > 0) {
        const loc = locJson.results[0];
        const locId: number = loc.id;
        const locName: string = loc.name || 'Valencia';

        if (isToday) {
          // Hoy: usar /latest para datos en tiempo real
          const latestUrl = `/api/v3/locations/${locId}/latest`;
          const latJson: any = await this.http.get(latestUrl).toPromise().catch(() => null);

          if (latJson?.results?.length > 0) {
            const readings = latJson.results;
            const get = (param: string) => {
              const r = readings.find((x: any) => x.parameter?.name === param || x.parameter === param);
              return r?.value ?? null;
            };
            const pm25 = get('pm25') ?? get('pm2.5') ?? 45;
            const pm10 = get('pm10') ?? 62;
            const no2 = get('no2') ?? 38;
            const o3 = get('o3') ?? 72;

            this.airQualitySignal.set({
              aqi: Math.round(pm25 * 1.5),
              category: this.getCategoryFromAQI(Math.round(pm25 * 1.5)),
              lastUpdated: now.toLocaleString('es-ES'),
              pollutants: [
                { name: 'PM2.5', value: Math.round(pm25), unit: 'µg/m³' },
                { name: 'PM10', value: Math.round(pm10), unit: 'µg/m³' },
                { name: 'NO₂', value: Math.round(no2), unit: 'µg/m³' },
                { name: 'O3', value: Math.round(o3), unit: 'µg/m³' },
              ],
              dataSource: 'real',
              sourceName: 'OpenAQ',
              locationName: locName
            });
            return;
          }
        } else {
          // Fecha pasada: buscar sensor de pm25 y pedir mediciones
          // Primero obtener sensores de esta localización
          const sensorsUrl = `/api/v3/locations/${locId}/sensors`;
          const sensJson: any = await this.http.get(sensorsUrl).toPromise().catch(() => null);

          if (sensJson?.results?.length > 0) {
            const allReadings: { pm25: number[]; pm10: number[]; no2: number[]; o3: number[] } = { pm25: [], pm10: [], no2: [], o3: [] };

            // Obtener mediciones para cada sensor relevante
            for (const sensor of sensJson.results) {
              const paramName: string = sensor.parameter?.name?.toLowerCase() || '';
              if (!['pm25', 'pm10', 'no2', 'o3', 'pm2.5'].includes(paramName)) continue;

              const measUrl = `/api/v3/sensors/${sensor.id}/measurements?date_from=${targetDate}T00:00:00Z&date_to=${targetDate}T23:59:59Z&limit=24`;
              const measJson: any = await this.http.get(measUrl).toPromise().catch(() => null);
              const vals = measJson?.results?.map((r: any) => r.value).filter((v: any) => v != null) ?? [];
              const avg = vals.length > 0 ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : null;

              if (avg === null) continue;
              if (paramName === 'pm25' || paramName === 'pm2.5') allReadings.pm25.push(avg);
              else if (paramName === 'pm10') allReadings.pm10.push(avg);
              else if (paramName === 'no2') allReadings.no2.push(avg);
              else if (paramName === 'o3') allReadings.o3.push(avg);
            }

            const avgOrDefault = (arr: number[], def: number) =>
              arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : def;

            const pm25 = avgOrDefault(allReadings.pm25, -1);
            // Solo usar si encontramos al menos algun dato
            if (pm25 >= 0) {
              const pm10 = avgOrDefault(allReadings.pm10, 62);
              const no2 = avgOrDefault(allReadings.no2, 38);
              const o3 = avgOrDefault(allReadings.o3, 72);

              this.airQualitySignal.set({
                aqi: Math.round(pm25 * 1.5),
                category: this.getCategoryFromAQI(Math.round(pm25 * 1.5)),
                lastUpdated: targetDate,
                pollutants: [
                  { name: 'PM2.5', value: Math.round(pm25), unit: 'µg/m³' },
                  { name: 'PM10', value: Math.round(pm10), unit: 'µg/m³' },
                  { name: 'NO₂', value: Math.round(no2), unit: 'µg/m³' },
                  { name: 'O3', value: Math.round(o3), unit: 'µg/m³' },
                ],
                dataSource: 'real',
                sourceName: 'OpenAQ',
                locationName: locName
              });
              return;
            }
          }
        }
      }

      // Fallback a WAQI para hoy
      if (isToday) {
        const token = '041a4eeeb23d0664c5486010da80c847e5cbb3b5';
        const waqiJson: any = await this.http.get(`/waqi-api/feed/valencia/?token=${token}`).toPromise().catch(() => null);
        if (waqiJson?.status === 'ok' && waqiJson.data) {
          const d = waqiJson.data;
          const iaqi = d.iaqi ?? {};
          const pollutants: AirPollutant[] = [];
          if (iaqi.pm25?.v != null) pollutants.push({ name: 'PM2.5', value: iaqi.pm25.v, unit: 'µg/m³' });
          if (iaqi.pm10?.v != null) pollutants.push({ name: 'PM10', value: iaqi.pm10.v, unit: 'µg/m³' });
          if (iaqi.no2?.v  != null) pollutants.push({ name: 'NO₂',  value: iaqi.no2.v,  unit: 'µg/m³' });
          this.airQualitySignal.set({
            aqi: d.aqi ?? 0,
            category: d.dominentpol ?? 'N/D',
            lastUpdated: d.time?.s ?? todayStr,
            pollutants,
            dataSource: 'real',
            sourceName: 'WAQI',
            locationName: d.city?.name || 'Valencia'
          });
          return;
        }
      }

      // Fallback a simulado
      this.generateSimulatedFallback(targetDate, isToday);
    } catch (e) {
      console.error('[ApiService] Error loading air quality data', e);
      this.generateSimulatedFallback(targetDate, isToday);
    }
  }

  private generateSimulatedFallback(targetDate: string, isToday: boolean): void {
    const dateSeed = targetDate.split('-').reduce((a, b) => a + parseInt(b), 0);
    const variation = (seed: number) => 0.7 + ((seed + dateSeed) % 60) / 100;

    this.airQualitySignal.set({
      aqi: Math.round(67 * variation(15)),
      category: this.getCategoryFromAQI(Math.round(67 * variation(15))),
      lastUpdated: targetDate + (isToday ? ' ' + new Date().toLocaleTimeString('es-ES') : ''),
      pollutants: [
        { name: 'PM2.5', value: Math.round(45 * variation(25)), unit: 'µg/m³' },
        { name: 'PM10', value: Math.round(62 * variation(35)), unit: 'µg/m³' },
        { name: 'NO₂', value: Math.round(38 * variation(45)), unit: 'µg/m³' },
        { name: 'O3', value: Math.round(72 * variation(55)), unit: 'µg/m³' },
      ],
      dataSource: 'simulated',
    });
  }

  private getCategoryFromAQI(aqi: number): string {
    if (aqi <= 50) return 'Buena';
    if (aqi <= 100) return 'Moderada';
    if (aqi <= 150) return 'No saludable para grupos sensibles';
    if (aqi <= 200) return 'No saludable';
    if (aqi <= 300) return 'Muy no saludable';
    return 'Peligrosa';
  }

  private async fetchWeatherValencia(): Promise<void> {
    const targetDate = this.selectedDateSignal();
    const todayStr = new Date().toISOString().split('T')[0];
    const isToday = targetDate === todayStr;
    const isFuture = targetDate > todayStr;

    if (isFuture) {
      this.weatherSignal.set(null);
      return;
    }

    try {
      // Usar datos simulados si no es hoy o si no hay API key válida
      if (!isToday || this.openWeatherKey.includes('appid=91cf68f7f32d87')) {
        const dateSeed = targetDate.split('-').reduce((a: number, b: string) => a + parseInt(b), 0);
        const variation = (seed: number) => 0.8 + ((seed + dateSeed) % 40) / 100;

        this.weatherSignal.set({
          temperature: Math.round(16 * variation(15)),
          rain: parseFloat((2.4 * variation(25)).toFixed(1)),
          rainProbability: Math.round(45 * variation(35)),
          humidity: Math.round(68 * variation(45)),
          rain24h: parseFloat((8.7 * variation(55)).toFixed(1)),
        });
        return;
      }

      const key = this.openWeatherKey.split('appid=')[1];
      const url = `/weather-api/data/2.5/weather?q=Valencia,ES&units=metric&appid=${key}&lang=es`;
      
      const json: any = await this.http.get(url).toPromise();

      const rain1h = json?.rain?.['1h'] ?? 0;
      const pop = json?.clouds?.all ?? 0;

      this.weatherSignal.set({
        temperature: json?.main?.temp ?? 0,
        rain: rain1h,
        rainProbability: pop,
        humidity: json?.main?.humidity ?? 0,
        rain24h: json?.rain?.['3h'] ? json.rain['3h'] * 8 : 0,
      });
    } catch (e) {
      console.error('[ApiService] Error loading weather data', e);
    }
  }

  private async fetchTrafficValencia(): Promise<void> {
    const targetDate = this.selectedDateSignal();
    const todayStr = new Date().toISOString().split('T')[0];
    const isToday = targetDate === todayStr;
    const isFuture = targetDate > todayStr;

    if (isFuture) {
      this.trafficSignal.set(null);
      return;
    }

    try {
      const dateSeed = targetDate.split('-').reduce((a, b) => a + parseInt(b), 0);
      const variation = (seed: number) => 0.8 + ((seed + dateSeed + (isToday ? new Date().getHours() : 0)) % 40) / 100;

      // Datos simulados de tráfico
      this.trafficSignal.set({
        overallCongestion: Math.round(73 * variation(5)),
        category: this.getTrafficCategory(Math.round(73 * variation(5))),
        streets: [
          { name: 'Avenida del Cid', congestion: Math.round(85 * variation(15)) },
          { name: 'Gran Vía', congestion: Math.round(68 * variation(25)) },
          { name: 'Blasco Ibáñez', congestion: Math.round(52 * variation(35)) },
        ],
      });
    } catch (e) {
      console.error('Error al obtener tráfico', e);
    }
  }

  private getTrafficCategory(congestion: number): string {
    if (congestion < 30) return 'Baja';
    if (congestion < 60) return 'Moderada';
    if (congestion < 80) return 'Alta';
    return 'Muy Alta';
  }

  private async fetchPollutionHistoryValencia(days: number = 7): Promise<void> {
    const targetDateStr = this.selectedDateSignal();
    const todayStr = new Date().toISOString().split('T')[0];
    
    if (targetDateStr > todayStr) {
      this.pollutionHistorySignal.set([]);
      return;
    }

    try {
      const endDate = new Date(targetDateStr + 'T23:59:59Z');
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - days);

      // Paso 1: Buscar ubicaciones usando OpenAQ v3
      const locUrl = `/api/v3/locations?coordinates=39.4699,-0.3763&radius=25000&limit=5`;
      const locJson: any = await this.http.get(locUrl).toPromise().catch(() => null);

      if (locJson?.results?.length > 0) {
        const locId: number = locJson.results[0].id;

        // Paso 2: Obtener sensores de esa localizacion
        const sensUrl = `/api/v3/locations/${locId}/sensors`;
        const sensJson: any = await this.http.get(sensUrl).toPromise().catch(() => null);

        if (sensJson?.results?.length > 0) {
          const dataByDate = new Map<string, { pm25: number[]; pm10: number[]; no2: number[]; o3: number[] }>();

          for (const sensor of sensJson.results) {
            const paramName: string = sensor.parameter?.name?.toLowerCase() || '';
            if (!['pm25', 'pm2.5', 'pm10', 'no2', 'o3'].includes(paramName)) continue;

            // Paso 3: Pedir mediciones históricas de cada sensor
            const measUrl = `/api/v3/sensors/${sensor.id}/measurements?date_from=${startDate.toISOString()}&date_to=${endDate.toISOString()}&limit=500`;
            const measJson: any = await this.http.get(measUrl).toPromise().catch(() => null);

            measJson?.results?.forEach((r: any) => {
              const dateStr = new Date(r.period?.datetimeTo?.utc || r.date?.utc || '').toISOString().split('T')[0];
              if (!dateStr || dateStr === 'Invalid') return;

              if (!dataByDate.has(dateStr)) dataByDate.set(dateStr, { pm25: [], pm10: [], no2: [], o3: [] });
              const d = dataByDate.get(dateStr)!;

              const v = r.value;
              if (v == null) return;
              if (paramName === 'pm25' || paramName === 'pm2.5') d.pm25.push(v);
              else if (paramName === 'pm10') d.pm10.push(v);
              else if (paramName === 'no2') d.no2.push(v);
              else if (paramName === 'o3') d.o3.push(v);
            });
          }

          if (dataByDate.size > 0) {
            const avg = (arr: number[], def: number) =>
              arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : def;

            const history: PollutionHistoryData[] = [];
            dataByDate.forEach((vals, date) => {
              history.push({
                date,
                pm25: avg(vals.pm25, 45),
                pm10: avg(vals.pm10, 62),
                no2: avg(vals.no2, 38),
                o3: avg(vals.o3, 72),
              });
            });
            history.sort((a, b) => a.date.localeCompare(b.date));
            this.pollutionHistorySignal.set(history);
            return;
          }
        }
      }

      this.generateSimulatedHistory(days);
    } catch (e) {
      console.error('[ApiService] Error loading pollution history', e);
      this.generateSimulatedHistory(days);
    }
  }

  private generateSimulatedHistory(days: number): void {
    const history: PollutionHistoryData[] = [];
    const baseValues = { pm25: 45, pm10: 62, no2: 38, o3: 72 };
    const targetDateStr = this.selectedDateSignal();
    const endDate = new Date(targetDateStr + 'T23:59:59Z');
    const dateSeed = targetDateStr.split('-').reduce((a, b) => a + parseInt(b), 0);
    
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      
      const daySeed = dateSeed + d.getDate();
      const variation = (seed: number) => 0.7 + ((seed + daySeed) % 60) / 100;
      
      history.push({
        date: dateStr,
        pm25: Math.round(baseValues.pm25 * variation(10)),
        pm10: Math.round(baseValues.pm10 * variation(20)),
        no2: Math.round(baseValues.no2 * variation(30)),
        o3: Math.round(baseValues.o3 * variation(40)),
      });
    }
    
    this.pollutionHistorySignal.set(history);
  }



  public async fetchPollutionHeatmapValencia(date?: string): Promise<PollutionHeatmapPoint[]> {
    const targetDate = date || this.selectedDateSignal();

    try {
      // OpenAQ v3: buscar todas las ubicaciones en el area de Valencia
      const locUrl = `/api/v3/locations?coordinates=39.4699,-0.3763&radius=50000&limit=100`;
      const locJson: any = await this.http.get(locUrl).toPromise().catch(() => null);

      if (locJson?.results?.length > 0) {
        const points: PollutionHeatmapPoint[] = [];

        // Para cada ubicacion, obtener su ultima lectura de PM2.5
        for (const loc of locJson.results.slice(0, 20)) {
          const lat = loc.coordinates?.latitude;
          const lng = loc.coordinates?.longitude;
          if (!lat || !lng) continue;

          const latestUrl = `/api/v3/locations/${loc.id}/latest`;
          const latJson: any = await this.http.get(latestUrl).toPromise().catch(() => null);
          const pm25 = latJson?.results?.find((r: any) =>
            r.parameter?.name?.toLowerCase() === 'pm25' || r.parameter?.name?.toLowerCase() === 'pm2.5'
          );
          if (pm25?.value != null && pm25.value > 0) {
            points.push({ lat, lng, value: Math.round(pm25.value), location: loc.name || 'Valencia' });
          }
        }

        if (points.length > 0) {
          const interpolated = this.interpolatePoints(points);
          return [...points, ...interpolated];
        }
      }
    } catch (error) {
      console.error('[ApiService] Error fetching heatmap data:', error);
    }

    return this.getFallbackData(targetDate);
  }
private interpolatePoints(mainPoints: PollutionHeatmapPoint[]): PollutionHeatmapPoint[] {
  const interpolated: PollutionHeatmapPoint[] = [];

  mainPoints.forEach(point => {
    // 6 puntos cercanos
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6;
      const radius = 0.005 + Math.random() * 0.008;
      interpolated.push({
        lat: point.lat + Math.cos(angle) * radius,
        lng: point.lng + Math.sin(angle) * radius,
        value: Math.round(point.value * (0.9 + Math.random() * 0.2)),
        location: point.location
      });
    }

    // 4 puntos más alejados
    for (let i = 0; i < 4; i++) {
      const angle = (Math.PI * 2 * i) / 4;
      const radius = 0.010 + Math.random() * 0.010;
      interpolated.push({
        lat: point.lat + Math.cos(angle) * radius,
        lng: point.lng + Math.sin(angle) * radius,
        value: Math.round(point.value * (0.85 + Math.random() * 0.3)),
        location: point.location
      });
    }
  });

  return interpolated;
}

  private getFallbackData(date?: string): Promise<PollutionHeatmapPoint[]> {
    const valenciaStations = [
      { lat: 39.4699, lng: -0.3763, name: 'Ciutat Vella', baseValue: 1.0 },
      { lat: 39.4800, lng: -0.3600, name: 'Burjassot (Universitat)', baseValue: 0.85 },
      { lat: 39.4600, lng: -0.3900, name: 'L\'Olivereta', baseValue: 0.9 },
      { lat: 39.4750, lng: -0.3700, name: 'Poblats Marítims', baseValue: 1.15 },
      { lat: 39.4650, lng: -0.3800, name: 'Eixample', baseValue: 1.1 },
      { lat: 39.4720, lng: -0.3750, name: 'Pla del Real', baseValue: 0.95 },
      { lat: 39.4680, lng: -0.3650, name: 'Extramurs', baseValue: 1.2 },
      { lat: 39.4780, lng: -0.3850, name: 'Campanar', baseValue: 0.88 },
      { lat: 39.4620, lng: -0.3750, name: 'Jesús', baseValue: 1.05 },
      { lat: 39.4700, lng: -0.3500, name: 'Alboraya', baseValue: 0.75 },
      { lat: 39.4550, lng: -0.3800, name: 'Patraix', baseValue: 0.92 },
      { lat: 39.4850, lng: -0.3700, name: 'Benimaclet', baseValue: 0.8 },
      { lat: 39.4750, lng: -0.3900, name: 'Quart de Poblet', baseValue: 0.95 },
      { lat: 39.4680, lng: -0.3400, name: 'Malva-rosa', baseValue: 0.7 },
      { lat: 39.4600, lng: -0.3600, name: 'Quatre Carreres', baseValue: 1.0 },
      { lat: 39.4720, lng: -0.3650, name: 'Russafa', baseValue: 1.15 },
      { lat: 39.4650, lng: -0.3700, name: 'Algirós', baseValue: 0.9 },
      { lat: 39.4800, lng: -0.3750, name: 'Rascanya', baseValue: 0.85 }
    ];

    const airQuality = this.airQualitySignal();
    const pm25Value = airQuality?.pollutants?.find(p => p.name === 'PM2.5')?.value || 45;
    const dateSeed = date ? date.split('-').reduce((a, b) => a + parseInt(b), 0) : 0;

    const mainPoints: PollutionHeatmapPoint[] = valenciaStations.map(station => {
      const latSeed = Math.floor(station.lat * 10000) % 50;
      const lngSeed = Math.floor(station.lng * 10000) % 50;
      const variation = station.baseValue * (0.8 + ((latSeed + lngSeed + dateSeed) % 40) / 100);
      
      return {
        lat: station.lat,
        lng: station.lng,
        value: Math.round(pm25Value * variation),
        location: station.name
      };
    });

    return Promise.resolve(mainPoints);
  }


/**
 * Opción 2: World Air Quality Index (WAQI) API
 * Requiere API key gratuita de https://aqicn.org/data-platform/token/
 */
  private async fetchFromWAQI(): Promise<PollutionHeatmapPoint[]> {
    try {
      const tokenFragment = this.aqicnToken.split('=')[1];
      const token = tokenFragment ? tokenFragment : '041a4eeeb23d0664c5486010da80c847e5cbb3b5';
      
      const valenciaLat = 39.4699;
      const valenciaLng = -0.3763;
      
      const url = `https://api.waqi.info/map/bounds/?latlng=${valenciaLat-0.1},${valenciaLng-0.1},${valenciaLat+0.1},${valenciaLng+0.1}&token=${token}`;
      
      const json: any = await this.http.get(url).toPromise();

      if (json?.status === 'ok' && json.data?.length > 0) {
        const points: PollutionHeatmapPoint[] = json.data.map((station: any) => ({
          lat: station.lat,
          lng: station.lon,
          value: station.aqi || 0,
          location: station.station?.name || 'Valencia'
        }));

        const interpolatedPoints = this.interpolatePoints(points);
        return [...points, ...interpolatedPoints];
      }

      throw new Error('No hay datos disponibles de WAQI');
    } catch (error) {
      console.error('[ApiService] Error loading WAQI data:', error);
      throw error;
    }
  }

  private async fetchFromAEMET(): Promise<PollutionHeatmapPoint[]> {
    try {
      const AEMET_API_KEY = 'TU_AEMET_API_KEY';
      const url = `https://opendata.aemet.es/opendata/api/red/especial/contaminacionfondo/estacion/8414A`;
      
      const json: any = await this.http.get(url, {
        headers: { 'api_key': AEMET_API_KEY }
      }).toPromise();
      
      if (json?.estado === 200 && json.datos) {
        const measurements: any = await this.http.get(json.datos).toPromise();
        
        const points: PollutionHeatmapPoint[] = measurements.map((m: any) => ({
          lat: parseFloat(m.lat) || 39.4699,
          lng: parseFloat(m.lon) || -0.3763,
          value: parseFloat(m.pm25) || 0,
          location: m.nombre || 'Valencia'
        }));

        const interpolatedPoints = this.interpolatePoints(points);
        return [...points, ...interpolatedPoints];
      }

      throw new Error('No hay datos disponibles de AEMET');
    } catch (error) {
      console.error('[ApiService] Error loading AEMET data:', error);
      throw error;
    }
  }

  private async fetchFromIQAir(): Promise<PollutionHeatmapPoint[]> {
    try {
      const API_KEY = 'TU_IQAIR_API_KEY';
      const url = `https://api.airvisual.com/v2/city?city=Valencia&state=Valencia&country=Spain&key=${API_KEY}`;
      
      const json: any = await this.http.get(url).toPromise();

      if (json?.status === 'success' && json.data) {
        const pm25 = json.data.current?.pollution?.aqius || 50;
        return this.createSimulatedPoints(pm25);
      }

      throw new Error('No hay datos disponibles de IQAir');
    } catch (error) {
      console.error('[ApiService] Error loading IQAir data:', error);
      throw error;
    }
  }

/**
 * Interpola puntos entre estaciones para crear un heatmap más denso
 */


/**
 * Crea puntos simulados basados en un valor base (usado cuando solo hay una lectura)
 */
private createSimulatedPoints(baseValue: number): PollutionHeatmapPoint[] {
  const valenciaStations = [
    { lat: 39.4699, lng: -0.3763, name: 'Centro', baseMultiplier: 1.0 },
    { lat: 39.4800, lng: -0.3600, name: 'Burjassot', baseMultiplier: 0.85 },
    { lat: 39.4600, lng: -0.3900, name: 'Quart de Poblet', baseMultiplier: 0.9 },
    { lat: 39.4750, lng: -0.3700, name: 'Poblats Marítims', baseMultiplier: 1.15 },
    { lat: 39.4650, lng: -0.3800, name: 'Eixample', baseMultiplier: 1.1 },
    { lat: 39.4720, lng: -0.3750, name: 'Pla del Real', baseMultiplier: 0.95 },
    { lat: 39.4680, lng: -0.3650, name: 'Ciutat Vella', baseMultiplier: 1.2 },
    { lat: 39.4780, lng: -0.3850, name: 'Campanar', baseMultiplier: 0.88 },
    { lat: 39.4620, lng: -0.3750, name: 'Jesús', baseMultiplier: 1.05 },
    { lat: 39.4700, lng: -0.3500, name: 'Alboraya', baseMultiplier: 0.75 },
    { lat: 39.4550, lng: -0.3800, name: 'Torrent', baseMultiplier: 0.92 },
    { lat: 39.4850, lng: -0.3700, name: 'Godella', baseMultiplier: 0.8 },
    { lat: 39.4750, lng: -0.3900, name: 'Manises', baseMultiplier: 0.95 },
    { lat: 39.4680, lng: -0.3400, name: 'Port Saplaya', baseMultiplier: 0.7 },
    { lat: 39.4600, lng: -0.3600, name: 'Nazaret', baseMultiplier: 1.0 },
    { lat: 39.4720, lng: -0.3650, name: 'Russafa', baseMultiplier: 1.15 },
    { lat: 39.4650, lng: -0.3700, name: 'Benimaclet', baseMultiplier: 0.9 },
    { lat: 39.4800, lng: -0.3750, name: 'Orriols', baseMultiplier: 0.85 }
  ];

  const mainPoints: PollutionHeatmapPoint[] = valenciaStations.map(station => ({
    lat: station.lat,
    lng: station.lng,
    value: Math.round(baseValue * station.baseMultiplier * (0.9 + Math.random() * 0.2)),
    location: station.name
  }));

  const interpolated = this.interpolatePoints(mainPoints);
  return [...mainPoints, ...interpolated];
}

/**
 * Datos de respaldo cuando todas las APIs fallan
 */

  public exportPollutionToCSV(data: PollutionHeatmapPoint[], filename: string = 'contaminacion_valencia'): void {
    if (!data || data.length === 0) {
      console.warn('[ApiService] No data available for CSV export');
      return;
    }

    const headers = ['Latitud', 'Longitud', 'Valor PM2.5'];
    const csvRows = [
      headers.join(','),
      ...data.map(point => [`"${point.lat}"`, `"${point.lng}"`, `"${point.value}"`].join(','))
    ];

    const csvContent = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}_${this.getTimestamp()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  public async exportPollutionToPDF(data: PollutionHeatmapPoint[], filename: string = 'contaminacion_valencia'): Promise<void> {
    if (!data || data.length === 0) {
      console.warn('[ApiService] No data available for PDF export');
      return;
    }

    try {
      const { default: jsPDF } = await import('jspdf');
      const autoTable = await import('jspdf-autotable');
      const doc = new jsPDF();
      
      doc.setFontSize(18);
      doc.text('Datos de Contaminación - Valencia', 14, 20);
      doc.setFontSize(10);
      doc.text(`Generado: ${new Date().toLocaleString('es-ES')}`, 14, 28);
      
      const tableData = data.map(point => [
        point.lat.toFixed(6),
        point.lng.toFixed(6),
        point.value.toFixed(2)
      ]);
      
      autoTable.default(doc, {
        head: [['Latitud', 'Longitud', 'Valor PM2.5 (μg/m³)']],
        body: tableData,
        startY: 35,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: { 0: { halign: 'right' }, 1: { halign: 'right' }, 2: { halign: 'center' } }
      });
      
      const finalY = (doc as any).lastAutoTable.finalY + 10;
      doc.setFontSize(12);
      doc.text('Resumen Estadístico', 14, finalY);
      
      const values = data.map(p => p.value);
      const avgValue = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);
      const maxValue = Math.max(...values).toFixed(2);
      const minValue = Math.min(...values).toFixed(2);
      
      doc.setFontSize(10);
      doc.text(`Total de puntos: ${data.length}`, 14, finalY + 8);
      doc.text(`Valor promedio PM2.5: ${avgValue} μg/m³`, 14, finalY + 14);
      doc.text(`Valor máximo: ${maxValue} μg/m³`, 14, finalY + 20);
      doc.text(`Valor mínimo: ${minValue} μg/m³`, 14, finalY + 26);
      
      doc.save(`${filename}_${this.getTimestamp()}.pdf`);
    } catch (error) {
      console.error('[ApiService] Error generating PDF:', error);
      throw error;
    }
  }

  private getTimestamp(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
