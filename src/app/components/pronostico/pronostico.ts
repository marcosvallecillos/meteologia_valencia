import { Component, computed } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { ApiService } from '../../service/api-service.service';

@Component({
  selector: 'app-pronostico',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  templateUrl: './pronostico.html',
  styleUrl: './pronostico.css'
})
export class Pronostico {
  readonly forecast = computed(() => this.api.forecast());

  constructor(private readonly api: ApiService) {}

  getTempColor(temp: number): string {
    if (temp < 15) return '#60a5fa'; // Blue
    if (temp < 25) return '#fbbf24'; // Amber
    return '#f87171'; // Red
  }
}
