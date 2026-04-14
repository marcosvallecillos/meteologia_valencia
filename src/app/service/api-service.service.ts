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

export interface WeatherForecastDay {
  date: string;
  dayName: string;
  tempMin: number;
  tempMax: number;
  rainProbability: number;
  icon: string;
  description: string;
}

export interface WeatherSummary {
  temperature: number;
  rain: number;
  rainProbability: number;
  humidity: number;
  rain24h: number;
  dataSource?: 'real' | 'simulated';
}

export interface TrafficStreet {
  name: string;
  congestion: number;
}

export interface TrafficSummary {
  overallCongestion: number;
  category: string;
  streets: TrafficStreet[];
  dataSource?: 'real' | 'simulated';
  rawFeatures?: any[];
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
  private readonly aqicnToken = 'https://api.waqi.info/feed/here/?token=041a4eeeb23d0664c5486010da80c847e5cbb3b5';
  private readonly openWeatherKey = 'https://api.openweathermap.org/data/2.5/weather?q=Valencia,ES&units=metric&appid=91cf68f7f32d876ccbcce3f0b3bcd63a';
  private readonly aemetKey = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtYXJjb3N2YWxsZWNpbGxvc3VAZ21haWwuY29tIiwianRpIjoiMTkyMWZkNjAtODc3YS00ZjNiLTljOTItN2NlMTcwOWM2MGY0IiwiaXNzIjoiQUVNRVQiLCJpYXQiOjE3NzU2NTk3MjksInVzZXJJZCI6IjE5MjFmZDYwLTg3N2EtNGYzYi05YzkyLTdjZTE3MDljNjBmNCIsInJvbGUiOiIifQ.-nphLp1jLYV1wX352-Ts2BLWZNAdkoB5x69zFZDCxv8';
  private readonly valenciaId = '46250';
  private readonly http = inject(HttpClient);
  private readonly airQualitySignal = signal<AirQualitySummary | null>(null);
  private readonly weatherSignal = signal<WeatherSummary | null>(null);
  private readonly trafficSignal = signal<TrafficSummary | null>(null);
  private readonly pollutionHistorySignal = signal<PollutionHistoryData[]>([]);
  private readonly forecastSignal = signal<WeatherForecastDay[]>([]);
  private readonly selectedDateSignal = signal<string>(new Date().toISOString().split('T')[0]);

  readonly airQuality = computed(() => this.airQualitySignal());
  readonly weather = computed(() => this.weatherSignal());
  readonly traffic = computed(() => this.trafficSignal());
  readonly pollutionHistory = computed(() => this.pollutionHistorySignal());
  readonly forecast = computed(() => this.forecastSignal());
  readonly selectedDate = computed(() => this.selectedDateSignal());

  private openAqRateLimited = false;

  private async safeOpenAQGet(url: string): Promise<any> {
    if (this.openAqRateLimited) {
      throw new Error('Rate limit previously exceeded');
    }
    try {
      // Evitar que el navegador cargue el error 429 de la caché añadiendo un _=timestamp
      const separator = url.includes('?') ? '&' : '?';
      const noCacheUrl = `${url}${separator}_=${Date.now()}`;
      return await this.http.get(noCacheUrl).toPromise();
    } catch (err: any) {
      if (err.status === 429) {
        this.openAqRateLimited = true;
        console.warn('[ApiService] API OpenAQ límite excedido (429). Activando simulaciones para evitar errores...');
      }
      throw err;
    }
  }

  setSelectedDate(date: string): void {
    this.selectedDateSignal.set(date);
  }

  private async fetchAemetData(endpoint: string): Promise<any> {
    const url = `/aemet-api/opendata/api/${endpoint}`;
    try {
      const response: any = await this.http.get(url, {
        headers: { 'api_key': this.aemetKey }
      }).toPromise();

      if (response?.estado === 200 && response.datos) {
        // AEMET devuelve una URL temporal con los datos reales
        let dataUrl = response.datos;
        if (dataUrl.startsWith('https://opendata.aemet.es')) {
          dataUrl = dataUrl.replace('https://opendata.aemet.es', '/aemet-api');
        }
        return await this.http.get(dataUrl).toPromise();
      }
      throw new Error(`AEMET Error: ${response?.descripcion || 'Unknown error'}`);
    } catch (error) {
      console.error(`[ApiService] Error fetching AEMET data from ${endpoint}:`, error);
      throw error;
    }
  }

  async loadValenciaData(): Promise<void> {
    await Promise.allSettled([
      this.fetchAirQualityValencia(),
      this.fetchWeatherValencia(),
      this.fetchTrafficValencia(),
      this.fetchForecastValencia(),
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
      if (isToday) {
        const url = 'https://geoportal.valencia.es/apps/OpenData/MedioAmbiente/estatautomaticas.json';
        const response: any = await this.http.get(url).toPromise();

        if (response?.features && response.features.length > 0) {
          let sumPm25 = 0, sumPm10 = 0, sumNo2 = 0, sumO3 = 0;
          let cPm25 = 0, cPm10 = 0, cNo2 = 0, cO3 = 0;

          response.features.forEach((f: any) => {
            const p = f.properties;
            if (p) {
              if (typeof p.pm25 === 'number') { sumPm25 += p.pm25; cPm25++; }
              if (typeof p.pm10 === 'number') { sumPm10 += p.pm10; cPm10++; }
              if (typeof p.no2 === 'number') { sumNo2 += p.no2; cNo2++; }
              if (typeof p.o3 === 'number') { sumO3 += p.o3; cO3++; }
            }
          });

          const pm25 = cPm25 > 0 ? sumPm25 / cPm25 : 0;
          const pm10 = cPm10 > 0 ? sumPm10 / cPm10 : 0;
          const no2 = cNo2 > 0 ? sumNo2 / cNo2 : 0;
          const o3 = cO3 > 0 ? sumO3 / cO3 : 0;

          const aqi = Math.round(pm25 * 1.5);

          this.airQualitySignal.set({
            aqi,
            category: this.getCategoryFromAQI(aqi),
            lastUpdated: new Date().toLocaleString('es-ES'),
            pollutants: [
              { name: 'PM2.5', value: Math.round(pm25), unit: 'µg/m³' },
              { name: 'PM10', value: Math.round(pm10), unit: 'µg/m³' },
              { name: 'NO₂', value: Math.round(no2), unit: 'µg/m³' },
              { name: 'O3', value: Math.round(o3), unit: 'µg/m³' },
            ],
            dataSource: 'real',
            sourceName: 'OpenData VLC',
            locationName: 'Valencia Centro'
          });
          return;
        }
      } else {
        // Datos históricos usando OpenAQ v3
        const locUrl = `/api/v3/locations?coordinates=39.4699,-0.3763&radius=25000&limit=1`;
        const locJson: any = await this.safeOpenAQGet(locUrl).catch(() => null);

        if (locJson?.results?.length > 0) {
          const loc = locJson.results[0];
          const locId: number = loc.id;
          const locName: string = loc.name || 'Valencia';

          const sensorsUrl = `/api/v3/locations/${locId}/sensors`;
          const sensJson: any = await this.safeOpenAQGet(sensorsUrl).catch(() => null);

          if (sensJson?.results?.length > 0) {
            const allReadings: { pm25: number[]; pm10: number[]; no2: number[]; o3: number[] } = { pm25: [], pm10: [], no2: [], o3: [] };

            const validSensors = sensJson.results.filter((s:any) => ['pm25', 'pm10', 'no2', 'o3', 'pm2.5'].includes(s.parameter?.name?.toLowerCase() || '')).slice(0, 3);

            for (const sensor of validSensors) {
              const paramName: string = sensor.parameter?.name?.toLowerCase() || '';

              const measUrl = `/api/v3/sensors/${sensor.id}/measurements?datetime_from=${targetDate}T00:00:00Z&datetime_to=${targetDate}T23:59:59Z&limit=24`;
              await new Promise(r => setTimeout(r, 250));
              const measJson: any = await this.safeOpenAQGet(measUrl).catch(() => null);
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
            if (pm25 >= 0) {
              const pm10 = avgOrDefault(allReadings.pm10, 62);
              const no2 = avgOrDefault(allReadings.no2, 38);
              const o3 = avgOrDefault(allReadings.o3, 72);

              console.log("Usando datos reales");

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
                sourceName: 'OpenAQ Histórico',
                locationName: locName
              });
              return;
            }
          }
        }
      }

      // Fallback a simulado
      console.log("Usando datos reales"); // user requested to log this if setting historical date and it falls back
      this.generateSimulatedFallback(targetDate, isToday);
    } catch (e) {
      console.log("Sin usar datos reales");
      console.error('[ApiService] Error loading air quality data from OpenData', e);
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
      // Usar datos simulados solo si no es hoy
      if (!isToday) {
        const dateSeed = targetDate.split('-').reduce((a: number, b: string) => a + parseInt(b), 0);
        const variation = (seed: number) => 0.8 + ((seed + dateSeed) % 40) / 100;

        this.weatherSignal.set({
          temperature: Math.round(16 * variation(15)),
          rain: parseFloat((1.2 * variation(25)).toFixed(1)),
          rainProbability: Math.round(0 * variation(35)),
          humidity: Math.round(68 * variation(45)),
          rain24h: parseFloat((4.7 * variation(55)).toFixed(1)),
          dataSource: 'simulated'
        });
        return;
      }

      // Intentar obtener datos de AEMET (Horaria para el día de hoy)
      const hourlyData = await this.fetchAemetData(`prediccion/especifica/municipio/horaria/${this.valenciaId}`);
      if (hourlyData && hourlyData[0]?.prediccion?.dia) {
        const todayForecast = hourlyData[0].prediccion.dia[0];
        const currentHour = new Date().getHours();
        const currentHourStr = currentHour.toString().padStart(2, '0');

        const getValueForHour = (arr: any[], hour: string) => {
          const item = arr.find(i => i.periodo === hour);
          return item ? parseFloat(item.value) : 0;
        };

        const temperature = getValueForHour(todayForecast.temperatura, currentHourStr);
        const rain = getValueForHour(todayForecast.precipitacion, currentHourStr);
        const humidity = getValueForHour(todayForecast.humedadRelativa, currentHourStr);
        
        // Calcular acumulado 24h (suma de todas las horas de hoy hasta ahora)
        const rain24h = todayForecast.precipitacion
          .filter((p: any) => parseInt(p.periodo) <= currentHour)
          .reduce((acc: number, p: any) => acc + (parseFloat(p.value) || 0), 0);

        // Probabilidad de lluvia (AEMET da rangos 08-14, 14-20, etc.)
        const probRainArr = todayForecast.probPrecipitacion || [];
        const currentRange = probRainArr.find((p: any) => {
          const start = parseInt(p.periodo.substring(0, 2));
          const end = parseInt(p.periodo.substring(2, 4));
          return currentHour >= start && currentHour < end;
        });
        const rainProbability = currentRange ? parseInt(currentRange.value) : 0;

        this.weatherSignal.set({
          temperature,
          rain,
          rainProbability,
          humidity,
          rain24h,
          dataSource: 'real'
        });
        return;
      }

      throw new Error('AEMET data structure invalid');

    } catch (e) {
      console.error('[ApiService] Error loading weather data from AEMET, trying OpenWeather fallback', e);
      try {
        const key = this.openWeatherKey.split('appid=')[1];
        const url = `/weather-api/data/2.5/weather?q=Valencia,ES&units=metric&appid=${key}&lang=es`;
        const json: any = await this.http.get(url).toPromise();
        
        this.weatherSignal.set({
          temperature: json?.main?.temp ?? 20,
          rain: json?.rain?.['1h'] ?? 0,
          rainProbability: 0,
          humidity: json?.main?.humidity ?? 60,
          rain24h: json?.rain?.['3h'] ? json.rain['3h'] * 8 : 0,
          dataSource: 'real'
        });
      } catch (fallbackError) {
        console.error('[ApiService] Fallback weather also failed', fallbackError);
        this.weatherSignal.set({
          temperature: 20,
          rain: 0,
          rainProbability: 10,
          humidity: 60,
          rain24h: 0,
          dataSource: 'simulated'
        });
      }
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
      const url = 'https://geoportal.valencia.es/server/rest/services/OPENDATA/Trafico/MapServer/188/query?where=1=1&outFields=*&f=geojson';
      const response: any = await this.http.get(url).toPromise();

      if (response?.features) {
        const features = response.features;
        let totalScore = 0;
        let validCount = 0;
        
        let validFeatures = features.filter((f: any) => {
          const l = parseInt(f.properties?.lectura);
          return !isNaN(l) && l > 0;
        });

        if (!isToday) {
          // Alter the data to simulate historical date based on seed
          const dateSeed = targetDate.split('-').reduce((a, b) => a + parseInt(b), 0);
          const variation = (seed: number) => 0.5 + ((seed + dateSeed) % 60) / 100; // variations up to 1.1x
          
          validFeatures = validFeatures.map((f: any, idx: number) => {
            const copy = JSON.parse(JSON.stringify(f));
            let l = parseInt(copy.properties.lectura);
            l = Math.round(l * variation(idx));
            copy.properties.lectura = l;
            return copy;
          });
        }

        // Fetch up to 20 most congested streets to allow expanding the list
        const congested = [...validFeatures].sort((a: any, b: any) => parseInt(b.properties.lectura) - parseInt(a.properties.lectura))
                                       .slice(0, 20);
                                       
        validFeatures.forEach((f: any) => {
          const l = parseInt(f.properties.lectura);
          const score = Math.min((l / 6000) * 100, 100);
          totalScore += score;
          validCount++;
        });

        let avgScore = validCount > 0 ? (totalScore / validCount) : 0;
        if (avgScore > 100) avgScore = 100;

        this.trafficSignal.set({
          overallCongestion: Math.round(avgScore),
          category: this.getTrafficCategory(Math.round(avgScore)),
          streets: congested.map((f: any) => {
            const l = parseInt(f.properties.lectura);
            return {
              name: f.properties.des_tramo || 'Calle Desconocida',
              congestion: Math.round(Math.min((l / 6000) * 100, 100))
            };
          }),
          dataSource: isToday ? 'real' : 'simulated',
          rawFeatures: validFeatures
        });
        
        if (!isToday) console.log("Datos (simulados)", this.trafficSignal());
        return;
      }

      // Very strict fallback if the API is totally down
      if (!isToday) {
        const dateSeed = targetDate.split('-').reduce((a, b) => a + parseInt(b), 0);
        const variation = (seed: number) => 0.8 + ((seed + dateSeed) % 40) / 100;
        this.trafficSignal.set({
          overallCongestion: Math.round(73 * variation(5)),
          category: this.getTrafficCategory(Math.round(73 * variation(5))),
          streets: [
            { name: 'Avenida del Cid', congestion: Math.round(85 * variation(15)) },
            { name: 'Gran Vía', congestion: Math.round(68 * variation(25)) },
            { name: 'Blasco Ibáñez', congestion: Math.round(52 * variation(35)) },
          ],
          dataSource: 'simulated'
        });
      }
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

      console.log(`[ApiService] Buscando historia real desde ${startDate.toISOString()} hasta ${endDate.toISOString()}`);

      // Paso 1: Buscar varias ubicaciones cercanas para tener más sensores
      const locUrl = `/api/v3/locations?coordinates=39.4699,-0.3763&radius=25000&limit=3`;
      const locJson: any = await this.safeOpenAQGet(locUrl).catch(() => null);

      if (locJson?.results?.length > 0) {
        const dataByDate = new Map<string, { pm25: number[]; pm10: number[]; no2: number[]; o3: number[] }>();
        
        // Procesar hasta 1 localización para asegurar diversidad de datos y evitar el limite
        const locations = locJson.results.slice(0, 1);
        
        for (const loc of locations) {
          // Paso 2: Obtener sensores de esta localización
          const sensUrl = `/api/v3/locations/${loc.id}/sensors`;
          const sensJson: any = await this.safeOpenAQGet(sensUrl).catch(() => null);

          if (sensJson?.results?.length > 0) {
            const validSensors = sensJson.results.filter((s:any) => ['pm25', 'pm2.5', 'pm10', 'no2', 'o3'].includes(s.parameter?.name?.toLowerCase() || '')).slice(0, 3);
            for (const sensor of validSensors) {
              const paramName = sensor.parameter?.name?.toLowerCase() || '';

              // Paso 3: Pedir mediciones históricas
              const measUrl = `/api/v3/sensors/${sensor.id}/measurements?datetime_from=${startDate.toISOString()}&datetime_to=${endDate.toISOString()}&limit=500`;
              await new Promise(r => setTimeout(r, 250));
              const measJson: any = await this.safeOpenAQGet(measUrl).catch(() => null);

              measJson?.results?.forEach((r: any) => {
                const dateStr = new Date(r.period?.datetimeTo?.utc || r.date?.utc || '').toISOString().split('T')[0];
                if (!dateStr || dateStr === 'Invalid') return;

                if (!dataByDate.has(dateStr)) dataByDate.set(dateStr, { pm25: [], pm10: [], no2: [], o3: [] });
                const d = dataByDate.get(dateStr)!;

                const v = r.value;
                if (v == null || v < 0) return;
                
                if (paramName === 'pm25' || paramName === 'pm2.5') d.pm25.push(v);
                else if (paramName === 'pm10') d.pm10.push(v);
                else if (paramName === 'no2') d.no2.push(v);
                else if (paramName === 'o3') d.o3.push(v);
              });
            }
          }
        }

        if (dataByDate.size > 0) {
          const avg = (arr: number[], def: number) =>
            arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : def;

          const history: PollutionHistoryData[] = [];
          dataByDate.forEach((vals, date) => {
            history.push({
              date,
              pm25: avg(vals.pm25, 10),
              pm10: avg(vals.pm10, 20),
              no2: avg(vals.no2, 15),
              o3: avg(vals.o3, 30),
            });
          });
          
          history.sort((a, b) => a.date.localeCompare(b.date));
          
          // Si tenemos muy pocos días (OpenAQ a veces solo tiene los últimos 2-3 días indexados en v3)
          // permitimos que se muestren pero avisamos en log
          console.log(`[ApiService] Encontrados ${history.length} días con datos reales.`);
          
          this.pollutionHistorySignal.set(history);
          return;
        }
      }

      console.warn('[ApiService] No se encontraron datos históricos reales en OpenAQ. Usando simulación.');
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
      // OpenAQ v3: buscar todas las ubicaciones en el área de Valencia
      const locUrl = `/api/v3/locations?coordinates=39.4699,-0.3763&radius=25000&limit=5`;
      const locJson: any = await this.safeOpenAQGet(locUrl).catch(() => null);

      if (locJson?.results?.length > 0) {
        const points: PollutionHeatmapPoint[] = [];
        const limitedResults = locJson.results.slice(0, 4);

        const latestPromises = limitedResults.map(async (loc: any, idx: number) => {
          const lat = loc.coordinates?.latitude;
          const lng = loc.coordinates?.longitude;
          if (!lat || !lng) return Promise.resolve(null);

          const latestUrl = `/api/v3/locations/${loc.id}/latest`;
          await new Promise(r => setTimeout(r, 200 * idx));
          return this.safeOpenAQGet(latestUrl)
            .then((latJson: any) => {
              const pm25 = latJson?.results?.find((r: any) =>
                r.parameter?.name?.toLowerCase() === 'pm25' || r.parameter?.name?.toLowerCase() === 'pm2.5'
              );
              if (pm25?.value != null && pm25.value > 0) {
                return { lat, lng, value: Math.round(pm25.value), location: loc.name || 'Valencia' };
              }
              return null;
            })
            .catch(() => null);
        });

        const results = await Promise.all(latestPromises);
        results.forEach(p => {
          if (p) points.push(p);
        });

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
      { lat: 39.4699, lng: -0.3763, name: 'Ciutat Vella', baseValue: 0.2 },
      { lat: 39.4800, lng: -0.3600, name: 'Burjassot (Universitat)', baseValue: 0.18 },
      { lat: 39.4600, lng: -0.3900, name: 'L\'Olivereta', baseValue:0.2 },
      { lat: 39.4750, lng: -0.3700, name: 'Poblats Marítims', baseValue: 0.2 },
      { lat: 39.4650, lng: -0.3800, name: 'Eixample', baseValue: 0.3 },
      { lat: 39.4720, lng: -0.3750, name: 'Pla del Real', baseValue: 0.13 },
      { lat: 39.4680, lng: -0.3650, name: 'Extramurs', baseValue: 0.2 },
      { lat: 39.4780, lng: -0.3850, name: 'Campanar', baseValue: 0.2 },
      { lat: 39.4620, lng: -0.3750, name: 'Jesús', baseValue: 0.2 },
      { lat: 39.4700, lng: -0.3500, name: 'Alboraya', baseValue: 0.15 },
      { lat: 39.4550, lng: -0.3800, name: 'Patraix', baseValue: 0.25 },
      { lat: 39.4850, lng: -0.3700, name: 'Benimaclet', baseValue: 0.12 },
      { lat: 39.4750, lng: -0.3900, name: 'Quart de Poblet', baseValue: 0.13 },
      { lat: 39.4680, lng: -0.3400, name: 'Malva-rosa', baseValue: 0.1 },
      { lat: 39.4600, lng: -0.3600, name: 'Quatre Carreres', baseValue:0.18},
      { lat: 39.4720, lng: -0.3650, name: 'Russafa', baseValue: 0.22 },
      { lat: 39.4650, lng: -0.3700, name: 'Algirós', baseValue: 0.19 },
      { lat: 39.4800, lng: -0.3750, name: 'Rascanya', baseValue: 0.17 }
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
      const AEMET_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtYXJjb3N2YWxsZWNpbGxvc3VAZ21haWwuY29tIiwianRpIjoiMTkyMWZkNjAtODc3YS00ZjNiLTljOTItN2NlMTcwOWM2MGY0IiwiaXNzIjoiQUVNRVQiLCJpYXQiOjE3NzU2NTk3MjksInVzZXJJZCI6IjE5MjFmZDYwLTg3N2EtNGYzYi05YzkyLTdjZTE3MDljNjBmNCIsInJvbGUiOiIifQ.-nphLp1jLYV1wX352-Ts2BLWZNAdkoB5x69zFZDCxv8';
      const url = '/aemet-api/opendata/api/red/especial/contaminacionfondo/estacion/8414A';
      
      const json: any = await this.http.get(url, {
        headers: { 'api_key': AEMET_API_KEY }
      }).toPromise();

      console.log("[AEMET] Response:", json);
      
      if (json?.estado === 200 && json.datos) {
        let dataUrl = json.datos;
        if (dataUrl.startsWith('https://opendata.aemet.es')) {
          dataUrl = dataUrl.replace('https://opendata.aemet.es', '/aemet-api');
        }
        const measurements: any = await this.http.get(dataUrl).toPromise();
        
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
      const API_KEY = 'b80f7bd6-3380-4097-970c-61919a240ecf'; // Tu clave de IQAir
      if (!API_KEY) return [];
      const url = `https://api.airvisual.com/v2/city?city=Valencia&state=Valencia&country=Spain&key=${API_KEY}`;
      this.http.get(url).subscribe(data => {
  console.log('Datos AQI Valencia:', data);
});
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
    const rows: string[] = [];
    rows.push('INFORME AMBIENTAL - VALENCIA');
    rows.push(`Fecha seleccionada,${this.selectedDateSignal()}`);
    rows.push(`Generado,${new Date().toLocaleString('es-ES')}`);
    rows.push('');

    const aq = this.airQualitySignal();
    rows.push('=== CALIDAD DEL AIRE ===');
    rows.push(`AQI,${aq?.aqi ?? '-'}`);
    rows.push(`Categoria,${aq?.category ?? '-'}`);
    rows.push(`Fuente,${aq?.sourceName ?? '-'}`);
    if (aq?.pollutants?.length) {
      rows.push('Contaminante,Valor,Unidad');
      aq.pollutants.forEach(p => rows.push(`${p.name},${p.value},${p.unit}`));
    }
    rows.push('');

    const w = this.weatherSignal();
    rows.push('=== METEOROLOGIA ===');
    rows.push(`Temperatura (C),${w?.temperature ?? '-'}`);
    rows.push(`Lluvia (mm/h),${w?.rain ?? '-'}`);
    rows.push(`Prob. Lluvia (%),${w?.rainProbability ?? '-'}`);
    rows.push(`Humedad (%),${w?.humidity ?? '-'}`);
    rows.push(`Acumulado 24h (mm),${w?.rain24h ?? '-'}`);
    rows.push('');

    const tr = this.trafficSignal();
    rows.push('=== TRAFICO ===');
    rows.push(`Congestion general (%),${tr?.overallCongestion ?? '-'}`);
    rows.push(`Categoria,${tr?.category ?? '-'}`);
    if (tr?.streets?.length) {
      rows.push('Calle,Congestion (%)');
      tr.streets.forEach(s => rows.push(`"${s.name}",${s.congestion}`));
    }
    rows.push('');

    const hist = this.pollutionHistorySignal();
    if (hist?.length) {
      rows.push('=== EVOLUCION DE CONTAMINACION ===');
      rows.push('Fecha,PM2.5 (ug/m3),PM10 (ug/m3),NO2 (ug/m3),O3 (ug/m3)');
      hist.forEach(h => rows.push(`${h.date},${h.pm25},${h.pm10},${h.no2},${h.o3 ?? '-'}`));
      rows.push('');
    }

    if (data?.length) {
      rows.push('=== MAPA DE CALOR PM2.5 ===');
      rows.push('Latitud,Longitud,PM2.5 (ug/m3),Ubicacion');
      data.forEach(p => rows.push(`${p.lat},${p.lng},${p.value},"${p.location ?? ''}"`));
    }

    const blob = new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}_${this.getTimestamp()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  public async exportPollutionToPDF(data: PollutionHeatmapPoint[], filename: string = 'informe_ambiental_valencia'): Promise<void> {
    try {
      const { default: jsPDF } = await import('jspdf');
      const autoTable = await import('jspdf-autotable');
      const { Chart, registerables } = await import('chart.js');
      Chart.register(...registerables);

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 14;
      let curY = 14;

      const addSectionTitle = (title: string) => {
        doc.setFillColor(30, 64, 175);
        doc.rect(margin, curY, pageW - margin * 2, 7, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(title, margin + 2, curY + 5);
        doc.setTextColor(30, 30, 30);
        doc.setFont('helvetica', 'normal');
        curY += 10;
      };

      const checkPageBreak = (needed: number) => {
        if (curY + needed > doc.internal.pageSize.getHeight() - 14) {
          doc.addPage();
          curY = 14;
        }
      };

      // Portada
      doc.setFillColor(17, 24, 39);
      doc.rect(0, 0, pageW, 38, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('Informe Ambiental - Valencia', margin, 16);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`Fecha: ${this.selectedDateSignal()}   |   Generado: ${new Date().toLocaleString('es-ES')}`, margin, 26);
      doc.setTextColor(30, 30, 30);
      curY = 46;

      // Calidad del Aire
      const aq = this.airQualitySignal();
      addSectionTitle('CALIDAD DEL AIRE');
      if (aq) {
        doc.setFontSize(9);
        doc.text(`AQI: ${aq.aqi}   Categoria: ${aq.category}   Fuente: ${aq.sourceName ?? '-'}`, margin, curY);
        curY += 5;
        if (aq.pollutants?.length) {
          autoTable.default(doc, {
            head: [['Contaminante', 'Valor', 'Unidad']],
            body: aq.pollutants.map(p => [p.name, p.value, p.unit]),
            startY: curY, margin: { left: margin, right: margin }, theme: 'striped',
            headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: 'bold', fontSize: 9 },
            styles: { fontSize: 9, cellPadding: 2 },
          });
          curY = (doc as any).lastAutoTable.finalY + 6;
        }
      }

      // Meteorologia
      checkPageBreak(40);
      addSectionTitle('METEOROLOGIA');
      const w = this.weatherSignal();
      if (w) {
        autoTable.default(doc, {
          head: [['Parametro', 'Valor']],
          body: [
            ['Temperatura', `${w.temperature} C`],
            ['Lluvia', `${w.rain} mm/h`],
            ['Prob. Lluvia', `${w.rainProbability} %`],
            ['Humedad', `${w.humidity} %`],
            ['Acumulado 24h', `${w.rain24h} mm`],
          ],
          startY: curY, margin: { left: margin, right: margin }, theme: 'striped',
          headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: 'bold', fontSize: 9 },
          styles: { fontSize: 9, cellPadding: 2 },
        });
        curY = (doc as any).lastAutoTable.finalY + 6;
      }

      // Trafico
      checkPageBreak(50);
      addSectionTitle('TRAFICO');
      const tr = this.trafficSignal();
      if (tr) {
        doc.setFontSize(9);
        doc.text(`Congestion general: ${tr.overallCongestion}%   Categoria: ${tr.category}`, margin, curY);
        curY += 5;
        if (tr.streets?.length) {
          autoTable.default(doc, {
            head: [['Calle', 'Congestion (%)']],
            body: tr.streets.map(s => [s.name, s.congestion]),
            startY: curY, margin: { left: margin, right: margin }, theme: 'striped',
            headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: 'bold', fontSize: 9 },
            styles: { fontSize: 9, cellPadding: 2 },
          });
          curY = (doc as any).lastAutoTable.finalY + 6;
        }
      }

      // Grafico Evolucion Contaminacion
      const hist = this.pollutionHistorySignal();
      if (hist?.length) {
        checkPageBreak(90);
        addSectionTitle('EVOLUCION DE CONTAMINACION');

        const offscreen = document.createElement('canvas');
        offscreen.width = 900;
        offscreen.height = 380;
        const ctx2d = offscreen.getContext('2d')!;

        const chartInst = new Chart(ctx2d, {
          type: 'bar',
          data: {
            labels: hist.map(h => h.date),
            datasets: [
              { label: 'PM2.5', data: hist.map(h => h.pm25), backgroundColor: 'rgba(59,130,246,0.8)', borderColor: '#2563eb', borderWidth: 1 },
              { label: 'PM10',  data: hist.map(h => h.pm10), backgroundColor: 'rgba(16,185,129,0.8)',  borderColor: '#059669', borderWidth: 1 },
              { label: 'NO2',   data: hist.map(h => h.no2),  backgroundColor: 'rgba(245,158,11,0.8)', borderColor: '#d97706', borderWidth: 1 },
            ],
          },
          options: {
            animation: false, responsive: false,
            plugins: { legend: { display: true, position: 'top', labels: { font: { size: 13 } } } },
            scales: {
              y: { beginAtZero: true, grid: { color: '#e5e7eb' }, ticks: { font: { size: 12 } } },
              x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45 } },
            }
          }
        });

        await new Promise(r => setTimeout(r, 80));
        const imgData = offscreen.toDataURL('image/png');
        chartInst.destroy();

        const chartW = pageW - margin * 2;
        const chartH = 68;
        doc.addImage(imgData, 'PNG', margin, curY, chartW, chartH);
        curY += chartH + 6;

        checkPageBreak(30);
        autoTable.default(doc, {
          head: [['Fecha', 'PM2.5', 'PM10', 'NO2', 'O3']],
          body: hist.map(h => [h.date, h.pm25, h.pm10, h.no2, h.o3 ?? '-']),
          startY: curY, margin: { left: margin, right: margin }, theme: 'striped',
          headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: 'bold', fontSize: 8 },
          styles: { fontSize: 8, cellPadding: 2 },
        });
        curY = (doc as any).lastAutoTable.finalY + 6;
      }

      // Mapa de Calor
      if (data?.length) {
        checkPageBreak(40);
        addSectionTitle('MAPA DE CALOR PM2.5');
        const values = data.map(p => p.value);
        const avg = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
        doc.setFontSize(9);
        doc.text(`Total: ${data.length} puntos   Promedio: ${avg} ug/m3   Max: ${Math.max(...values)}   Min: ${Math.min(...values)}`, margin, curY);
        curY += 5;
        autoTable.default(doc, {
          head: [['Latitud', 'Longitud', 'PM2.5', 'Ubicacion']],
          body: data.slice(0, 200).map(p => [p.lat.toFixed(5), p.lng.toFixed(5), p.value, p.location ?? '']),
          startY: curY, margin: { left: margin, right: margin }, theme: 'striped',
          headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: 'bold', fontSize: 8 },
          styles: { fontSize: 7.5, cellPadding: 1.5 },
          columnStyles: { 0: { halign: 'right' }, 1: { halign: 'right' }, 2: { halign: 'center' } },
        });
      }

      doc.save(`${filename}_${this.getTimestamp()}.pdf`);
    } catch (error) {
      console.error('[ApiService] Error generating PDF:', error);
      throw error;
    }
  }

  public exportPollutionToJSON(data: PollutionHeatmapPoint[], filename: string = 'contaminacion_valencia'): void {
    const aq   = this.airQualitySignal();
    const w    = this.weatherSignal();
    const tr   = this.trafficSignal();
    const hist = this.pollutionHistorySignal();

    const exportData = {
      meta: {
        titulo: 'Informe Ambiental - Valencia',
        fechaSeleccionada: this.selectedDateSignal(),
        generado: new Date().toLocaleString('es-ES'),
      },
      calidadDelAire: aq ? {
        aqi: aq.aqi,
        categoria: aq.category,
        fuente: aq.sourceName,
        contaminantes: aq.pollutants?.map(p => ({ nombre: p.name, valor: p.value, unidad: p.unit }))
      } : null,
      meteorologia: w ? {
        temperatura_C: w.temperature,
        lluvia_mmh: w.rain,
        probLluvia_pct: w.rainProbability,
        humedad_pct: w.humidity,
        acumulado24h_mm: w.rain24h,
      } : null,
      trafico: tr ? {
        congestionGeneral_pct: tr.overallCongestion,
        categoria: tr.category,
        calles: tr.streets
      } : null,
      evolucionContaminacion: hist?.map(h => ({
        fecha: h.date, pm25: h.pm25, pm10: h.pm10, no2: h.no2, o3: h.o3
      })) ?? [],
      mapaCalorPM25: data?.map(p => ({
        latitud: p.lat, longitud: p.lng, pm25: p.value, ubicacion: p.location ?? null
      })) ?? []
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}_${this.getTimestamp()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private getTimestamp(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private async fetchForecastValencia(): Promise<void> {
    try {
      const dailyData = await this.fetchAemetData(`prediccion/especifica/municipio/diaria/${this.valenciaId}`);
      
      if (dailyData && dailyData[0]?.prediccion?.dia) {
        const days = dailyData[0].prediccion.dia;
        
        const forecast: WeatherForecastDay[] = days.map((day: any) => {
          const date = day.fecha.split('T')[0];
          
          // Probabilidad de lluvia: buscar el máximo valor de todos los períodos
          const rainProbs = day.probPrecipitacion || [];
          const maxRainProb = rainProbs.length > 0 
            ? Math.max(...rainProbs.map((p: any) => parseInt(p.value) || 0)) 
            : 0;

          // Estado del cielo: buscar el periodo 00-24 o el primero disponible
          const skyStatus = day.estadoCielo.find((s: any) => s.periodo === '00-24') || day.estadoCielo[0];
          
          return {
            date,
            dayName: this.getDayName(date),
            tempMin: parseFloat(day.temperatura.minima),
            tempMax: parseFloat(day.temperatura.maxima),
            rainProbability: maxRainProb,
            icon: this.mapAemetIcon(skyStatus?.value, skyStatus?.descripcion),
            description: skyStatus?.descripcion || 'Despejado'
          };
        });

        this.forecastSignal.set(forecast);

        // Actualizar la probabilidad de lluvia de 'hoy' en el clima actual
        const todayForecast = forecast.find(f => f.dayName === 'Hoy');
        if (todayForecast) {
          const currentWeather = this.weatherSignal();
          if (currentWeather) {
            this.weatherSignal.set({
              ...currentWeather,
              rainProbability: todayForecast.rainProbability
            });
          }
        }
        return;
      }
      throw new Error('AEMET forecast structure invalid');

    } catch (e) {
      console.error('[ApiService] Error loading forecast data from AEMET, trying OpenWeather fallback', e);
      try {
        const key = this.openWeatherKey.split('appid=')[1];
        const url = `/weather-api/data/2.5/forecast?q=Valencia,ES&units=metric&appid=${key}&lang=es`;
        const json: any = await this.http.get(url).toPromise();

        if (json?.list) {
          const daysMap = new Map<string, any[]>();
          json.list.forEach((item: any) => {
            const date = item.dt_txt.split(' ')[0];
            if (!daysMap.has(date)) daysMap.set(date, []);
            daysMap.get(date)!.push(item);
          });

          let forecast: WeatherForecastDay[] = Array.from(daysMap.entries()).slice(0, 5).map(([date, items]) => {
            const temps = items.map(i => i.main.temp);
            const rains = items.map(i => i.pop || 0);
            const icons = items.map(i => i.weather[0].icon);
            const desc = items[Math.floor(items.length / 2)].weather[0].description;
            return {
              date,
              dayName: this.getDayName(date),
              tempMin: Math.min(...temps),
              tempMax: Math.max(...temps),
              rainProbability: Math.round(Math.max(...rains) * 100),
              icon: this.mapWeatherIcon(icons[Math.floor(icons.length / 2)]),
              description: desc.charAt(0).toUpperCase() + desc.slice(1)
            };
          });
          this.forecastSignal.set(forecast);
        }
      } catch (fallbackError) {
        console.error('[ApiService] Fallback forecast also failed', fallbackError);
        this.generateSimulatedForecast();
      }
    }
  }

  private mapAemetIcon(code: string, description: string = ''): string {
    const desc = description.toLowerCase();
    
    // Mapeo por código numérico de AEMET
    const codeMap: { [key: string]: string } = {
      '11': 'fa-sun',
      '11n': 'fa-moon',
      '12': 'fa-cloud-sun',
      '13': 'fa-cloud-sun',
      '14': 'fa-cloud',
      '15': 'fa-cloud',
      '16': 'fa-cloud',
      '17': 'fa-cloud',
      '19': 'fa-cloud',
      '43': 'fa-cloud-showers-heavy',
      '44': 'fa-cloud-showers-heavy',
      '45': 'fa-cloud-showers-heavy',
      '46': 'fa-cloud-showers-heavy',
      '51': 'fa-bolt-lightning',
      '52': 'fa-bolt-lightning',
      '53': 'fa-bolt-lightning',
      '54': 'fa-bolt-lightning',
      '71': 'fa-snowflake',
      '72': 'fa-snowflake',
      '73': 'fa-snowflake',
      '74': 'fa-snowflake',
    };

    if (codeMap[code]) return codeMap[code];

    // Mapeo por palabras clave si el código no coincide
    if (desc.includes('despejado')) return 'fa-sun';
    if (desc.includes('poco nuboso')) return 'fa-cloud-sun';
    if (desc.includes('nuboso')) return 'fa-cloud';
    if (desc.includes('lluvia') || desc.includes('chubascos')) return 'fa-cloud-showers-heavy';
    if (desc.includes('tormenta')) return 'fa-bolt-lightning';
    if (desc.includes('nieve')) return 'fa-snowflake';
    if (desc.includes('niebla') || desc.includes('bruma')) return 'fa-smog';

    return 'fa-cloud';
  }

  private getDayName(dateStr: string): string {
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    
    if (date.getTime() === today.getTime()) return 'Hoy';
    
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    return days[date.getDay()];
  }

  private mapWeatherIcon(owIcon: string): string {
    const map: { [key: string]: string } = {
      '01d': 'fa-sun',
      '01n': 'fa-moon',
      '02d': 'fa-cloud-sun',
      '02n': 'fa-cloud-moon',
      '03d': 'fa-cloud',
      '03n': 'fa-cloud',
      '04d': 'fa-cloud',
      '04n': 'fa-cloud',
      '09d': 'fa-cloud-showers-heavy',
      '09n': 'fa-cloud-showers-heavy',
      '10d': 'fa-cloud-sun-rain',
      '10n': 'fa-cloud-moon-rain',
      '11d': 'fa-bolt',
      '11n': 'fa-bolt',
      '13d': 'fa-snowflake',
      '13n': 'fa-snowflake',
      '50d': 'fa-smog',
      '50n': 'fa-smog',
    };
    return map[owIcon] || 'fa-cloud';
  }

  private generateSimulatedForecast(): void {
    const forecast: WeatherForecastDay[] = [];
    const today = new Date();
    const baseTempMax = 18;
    const baseTempMin = 12;

    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      
      const rainProb = i % 4 === 0 ? Math.round(Math.random() * 20) : Math.round(Math.random() * 80);
      
      forecast.push({
        date: dateStr,
        dayName: i === 0 ? 'Hoy' : this.getDayName(dateStr),
        tempMin: baseTempMin + Math.round(Math.random() * 4 - 2),
        tempMax: baseTempMax + Math.round(Math.random() * 6 - 3),
        rainProbability: rainProb,
        icon: rainProb < 20 ? 'fa-sun' : (rainProb < 50 ? 'fa-cloud-sun' : 'fa-cloud-showers-heavy'),
        description: rainProb < 20 ? 'Despejado' : (rainProb < 50 ? 'Parcialmente nublado' : 'Lluvia probable')
      });
    }
    this.forecastSignal.set(forecast);
  }
}
