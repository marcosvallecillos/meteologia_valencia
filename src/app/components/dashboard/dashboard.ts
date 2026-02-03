import { Component, OnInit, computed } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Trafico } from '../trafico/trafico';
import { ApiService } from '../../service/api-service.service';
import { GraficoContaminacion } from '../grafico-contaminacion/grafico-contaminacion';

@Component({
  selector: 'app-dashboard',
  imports: [Trafico, DecimalPipe,GraficoContaminacion],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit {
  readonly airQuality = computed(() => {
    const data = this.api.airQuality();
    if (data?.pollutants) {
      // Asignar un máximo por contaminante
      const maxValues: { [key: string]: number } = { 
        'PM2.5': 100, 
        'PM10': 100, 
        'NO₂': 100,
        'NO2': 100,
        'O3': 100 
      };
      data.pollutants.forEach(p => p.max = maxValues[p.name] ?? 100);
    }
    return data;
  });
  
  readonly weather = computed(() => this.api.weather());
  readonly humidity = computed(() => this.weather()?.humidity ?? 0);
  
  readonly pm25Value = computed(() => {
    const pm25 = this.airQuality()?.pollutants?.find(p => p.name === 'PM2.5');
    return pm25?.value ?? 0;
  });
  
  readonly otherPollutants = computed(() => {
    return this.airQuality()?.pollutants?.filter(p => p.name !== 'PM2.5') ?? [];
  }); 
  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.api.loadValenciaData();
  }

  getPollutantPercentage(pollutant: { value: number; max?: number }): number {
    const max = pollutant.max ?? 100;
    if (max === 0) return 0;
    const percentage = (pollutant.value / max) * 100;
    return Math.min(Math.max(percentage, 0), 100); // Asegurar que esté entre 0 y 100
  }
}


