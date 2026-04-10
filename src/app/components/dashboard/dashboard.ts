import { Component, OnInit, computed, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Trafico } from '../trafico/trafico';
import { ApiService } from '../../service/api-service.service';
import { GraficoContaminacion } from '../grafico-contaminacion/grafico-contaminacion';
import { Leaflet } from '../leaflet/leaflet';

@Component({
  selector: 'app-dashboard',
  imports: [Trafico, DecimalPipe, GraficoContaminacion, Leaflet],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit {
  
  // Signal para el estado de carga
  readonly loading = signal<boolean>(false);

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
  
  readonly selectedDate = computed(() => this.api.selectedDate());
  readonly isFutureDate = signal<boolean>(false);
  
  readonly weatherIcon = computed(() => {
    const temp = this.weather()?.temperature ?? 20;
    if (temp < 15) return 'fa-cloud';
    if (temp < 22) return 'fa-cloud-sun';
    return 'fa-sun';
  });

  readonly weatherColor = computed(() => {
    const temp = this.weather()?.temperature ?? 20;
    if (temp < 15) return '#94a3b8'; // Slate
    if (temp < 22) return '#fbbf24'; // Amber
    return '#f59e0b'; // Orange
  });

  readonly otherPollutants = computed(() => {
    return this.airQuality()?.pollutants?.filter(p => p.name !== 'PM2.5') ?? [];
  }); 


  constructor(private readonly api: ApiService) {}

  onDateChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.value) {
      const selected = new Date(input.value);
      const today = new Date();
      // Solo comparar año, mes y día
      today.setHours(0, 0, 0, 0);
      
      if (selected > today) {
        this.isFutureDate.set(true);
        this.api.setSelectedDate(input.value);
        return;
      }

      this.isFutureDate.set(false);
      this.api.setSelectedDate(input.value);
      // Recargar datos para que afecte a toda la web
      this.api.loadValenciaData();
    }
  }

  ngOnInit(): void {
    this.api.loadValenciaData();
  }

  /**
   * Calcula el porcentaje de un contaminante respecto a su valor máximo
   */
  getPollutantPercentage(pollutant: { value: number; max?: number }): number {
    const max = pollutant.max ?? 100;
    if (max === 0) return 0;
    const percentage = (pollutant.value / max) * 100;
    return Math.min(Math.max(percentage, 0), 100);
  }

  /**
   * Exporta los datos de contaminación a formato CSV
   */
  async exportarCSV(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    try {
      const datos = await this.api.fetchPollutionHeatmapValencia();
      
      if (!datos || datos.length === 0) {
        console.warn('No hay datos disponibles para exportar');
        alert('No hay datos de contaminación disponibles para exportar');
        return;
      }
      
      this.api.exportPollutionToCSV(datos, 'contaminacion_valencia');
      console.log(`CSV exportado exitosamente: ${datos.length} registros`);
      
    } catch (error) {
      console.error('Error al exportar CSV:', error);
      alert('Hubo un error al generar el archivo CSV. Por favor, inténtalo de nuevo.');
    } finally {
      this.loading.set(false);
    } 
  }

  /**
   * Exporta los datos de contaminación a formato PDF
   */
  async exportarPDF(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    try {
      const datos = await this.api.fetchPollutionHeatmapValencia();
      
      if (!datos || datos.length === 0) {
        console.warn('No hay datos disponibles para exportar');
        alert('No hay datos de contaminación disponibles para exportar');
        return;
      }
      
      await this.api.exportPollutionToPDF(datos, 'contaminacion_valencia');
      console.log(`PDF exportado exitosamente: ${datos.length} registros`);
    } catch (error) {
      console.error('Error al exportar PDF:', error);
      alert('Hubo un error al generar el archivo PDF. Por favor, inténtalo de nuevo.');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Exporta datos filtrados por rango de valores PM2.5
   */
  async exportarPDFFiltrado(minValue?: number, maxValue?: number): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    try {
      const datos = await this.api.fetchPollutionHeatmapValencia();
      
      if (!datos || datos.length === 0) {
        console.warn('No hay datos disponibles para exportar');
        alert('No hay datos de contaminación disponibles');
        return;
      }

      // Filtrar datos por rango
      let datosFiltrados = datos;
      if (minValue !== undefined || maxValue !== undefined) {
        datosFiltrados = datos.filter(point => {
          const withinMin = minValue === undefined || point.value >= minValue;
          const withinMax = maxValue === undefined || point.value <= maxValue;
          return withinMin && withinMax;
        });
      }

      if (datosFiltrados.length === 0) {
        alert('No hay datos que cumplan los criterios de filtrado');
        return;
      }
      
      await this.api.exportPollutionToPDF(datosFiltrados, 'contaminacion_valencia_filtrado');
      console.log(`PDF filtrado exportado: ${datosFiltrados.length} de ${datos.length} registros`);
      
    } catch (error) {
      console.error('Error al exportar PDF filtrado:', error);
      alert('Hubo un error al generar el archivo PDF filtrado.');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Obtiene la fecha actual en formato YYYY-MM-DD
   */
  getCurrentDate(): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
} 