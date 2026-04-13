import { Component, computed, signal, NgZone } from '@angular/core';
import { ApiService } from '../../service/api-service.service';
import * as L from 'leaflet';

@Component({
  selector: 'app-trafico',
  imports: [],
  templateUrl: './trafico.html',
  styleUrl: './trafico.css',
})
export class Trafico {
  readonly traffic = computed(() => this.api.traffic());
  
  visibleStreets = computed(() => {
    return this.traffic()?.streets?.slice(0, 3) || [];
  });

  extraStreets = computed(() => {
    return this.traffic()?.streets?.slice(3) || [];
  });

  hasMoreStreets = computed(() => {
    return this.extraStreets().length > 0;
  });

  isMapVisible = signal<boolean>(false);
  selectedStreetData = signal<any>(null); // For the modal
  private map: L.Map | null = null;

  constructor(private readonly api: ApiService, private zone: NgZone) {}
  
  getCongestionPercentage(congestion: number): number {
    return Math.min(Math.max(congestion, 0), 100);
  }

  getColorForCongestion(percent: number): string {
    if (percent < 30) return '#10b981'; // Green
    if (percent < 60) return '#f59e0b'; // Yellow
    if (percent < 85) return '#ef4444'; // Red
    return '#8b0000'; // Dark Red
  }

  toggleMap(): void {
    const nextState = !this.isMapVisible();
    this.isMapVisible.set(nextState);

    if (nextState) {
      setTimeout(() => this.initMap(), 100);
    } else {
      if (this.map) {
        this.map.remove();
        this.map = null;
      }
    }
  }
  
  closeModal(): void {
    this.selectedStreetData.set(null);
  }

  initMap() {
    if (this.map) {
       this.map.remove();
    }
    const mapElement = document.getElementById('trafficMap');
    if (!mapElement) return;

    this.map = L.map('trafficMap', {
       center: [39.47, -0.37],
       zoom: 13,
       preferCanvas: true
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(this.map);

    const trafficData = this.traffic()?.rawFeatures;
    if (trafficData) {
       trafficData.forEach(feature => {
          const l = parseInt(feature.properties.lectura);
          let congestion = 0;
          if (!isNaN(l) && l > 0) {
              congestion = Math.min((l / 6000) * 100, 100);
          }
          const color = this.getColorForCongestion(congestion);
          
          L.geoJSON(feature as any, {
             style: {
                color: color,
                weight: 8,
                opacity: 0.9
             }
          }).on('click', () => {
             this.zone.run(() => {
                this.selectedStreetData.set({
                   name: feature.properties.des_tramo || 'Calle sin nombre',
                   idtramo: feature.properties.idtramo || '-',
                   lectura: parseInt(feature.properties.lectura) > 0 ? feature.properties.lectura : 0,
                   imv: feature.properties.imv || '-',
                   congestion: Math.round(congestion),
                   color: color
                });
             });
          }).addTo(this.map!);
       });
    }
  }
}

