import { Injectable, computed, signal } from '@angular/core';

export interface AirPollutant {
  name: string;
  value: number;
  unit: string;
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

  readonly airQuality = computed(() => this.airQualitySignal());
  readonly weather = computed(() => this.weatherSignal());

  async loadValenciaData(): Promise<void> {
    await Promise.allSettled([
      this.fetchAirQualityValencia(),
      this.fetchWeatherValencia(),
    ]);
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
            { name: 'PM2.5', value: 18, unit: 'µg/m³' },
            { name: 'PM10', value: 32, unit: 'µg/m³' },
            { name: 'NO₂', value: 21, unit: 'µg/m³' },
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
          rainProbability: 40,
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
      });
    } catch (e) {
      console.error('Error al obtener meteo', e);
    }
  }
}
