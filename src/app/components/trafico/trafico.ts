import { Component, computed } from '@angular/core';
import { ApiService } from '../../service/api-service.service';

@Component({
  selector: 'app-trafico',
  imports: [],
  templateUrl: './trafico.html',
  styleUrl: './trafico.css',
})
export class Trafico {
  readonly traffic = computed(() => this.api.traffic());
  
  constructor(private readonly api: ApiService) {}
  
  getCongestionPercentage(congestion: number): number {
    return Math.min(Math.max(congestion, 0), 100);
  }
}
