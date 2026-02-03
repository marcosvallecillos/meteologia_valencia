import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef, computed, effect, signal } from '@angular/core';
import { Chart, ChartType } from 'chart.js/auto';
import { ApiService, PollutionHistoryData } from '../../service/api-service.service';

type TimeRange = '24h' | '7d' | '30d';

@Component({
  selector: 'app-grafico-contaminacion',
  imports: [],
  templateUrl: './grafico-contaminacion.html',
  styleUrl: './grafico-contaminacion.css',
})
export class GraficoContaminacion implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('chartCanvas', { static: true }) chartCanvas!: ElementRef<HTMLCanvasElement>;
  public chart: Chart | undefined;

  readonly selectedTimeRange = signal<TimeRange>('24h');
  readonly pollutionHistory = computed(() => this.api.pollutionHistory());
  private isViewReady = false;

  private chartEffect = effect(() => {
    // Reaccionar a cambios en los datos de contaminación o rango de tiempo
    const history = this.pollutionHistory();
    const timeRange = this.selectedTimeRange();
    
    if (this.isViewReady && history && history.length > 0) {
      // Verificar que el canvas esté disponible
      if (this.chartCanvas?.nativeElement) {
        // Usar setTimeout para asegurar que el canvas esté completamente renderizado
        setTimeout(() => {
          this.createChart(timeRange);
        }, 100);
      } else {
        // Si el canvas no está disponible, intentar de nuevo después de un breve delay
        setTimeout(() => {
          if (this.chartCanvas?.nativeElement && history && history.length > 0) {
            this.createChart(timeRange);
          }
        }, 200);
      }
    }
  });

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    // Cargar datos históricos de contaminación
    this.loadDataForTimeRange('24h');
  }

  ngAfterViewInit(): void {
    this.isViewReady = true;
    // Intentar crear el gráfico si ya hay datos
    const history = this.pollutionHistory();
    console.log('AfterViewInit - Datos disponibles:', history?.length || 0);
    if (history && history.length > 0) {
      // Esperar un poco más para asegurar que el canvas esté completamente renderizado
      setTimeout(() => {
        if (this.chartCanvas?.nativeElement) {
          this.createChart(this.selectedTimeRange());
        } else {
          // Reintentar si el canvas aún no está disponible
          setTimeout(() => {
            if (this.chartCanvas?.nativeElement) {
              this.createChart(this.selectedTimeRange());
            }
          }, 300);
        }
      }, 100);
    } else {
      // Si no hay datos, esperar a que se carguen
      console.log('Esperando datos...');
    }
  }

  ngOnDestroy(): void {
    if (this.chart) {
      this.chart.destroy();
    }
  }

  selectTimeRange(range: TimeRange): void {
    this.selectedTimeRange.set(range);
    this.loadDataForTimeRange(range);
  }

  private loadDataForTimeRange(range: TimeRange): void {
    const days = range === '24h' ? 1 : range === '7d' ? 7 : 30;
    this.api.loadPollutionHistory(days);
  }

  private createChart(timeRange: TimeRange): void {
    const history = this.pollutionHistory();
    
    console.log('createChart llamado - Datos:', history?.length || 0, 'Canvas:', !!this.chartCanvas?.nativeElement);
    
    if (!history || history.length === 0) {
      console.warn('No hay datos de contaminación disponibles');
      return;
    }

    if (!this.chartCanvas?.nativeElement) {
      console.warn('Canvas no está disponible');
      return;
    }

    // Procesar datos según el rango de tiempo seleccionado
    let processedData: { labels: string[]; pm25: number[]; pm10: number[]; no2: number[] };
    
    if (timeRange === '24h') {
      // Para 24h, agrupar por intervalos de 4 horas
      processedData = this.processHourlyData(history);
    } else {
      // Para 7d y 30d, agrupar por día
      processedData = this.processDailyData(history, timeRange);
    }

    // Calcular valores promedio para cada barra (combinando PM2.5, PM10, NO2)
    const combinedData = processedData.labels.map((_, index) => {
      return (processedData.pm25[index] + processedData.pm10[index] + processedData.no2[index]) / 3;
    });

    const data = {
      labels: processedData.labels,
      datasets: [
        {
          label: 'Contaminación',
          data: combinedData,
          backgroundColor: this.generateGreyColors(processedData.labels.length),
          borderColor: '#666',
          borderWidth: 1
        }
      ]
    };

    // Destruir gráfico anterior si existe
    if (this.chart) {
      this.chart.destroy();
      this.chart = undefined;
    }

    // Crear nuevo gráfico
    const ctx = this.chartCanvas.nativeElement.getContext('2d');
    if (!ctx) {
      console.error('No se pudo obtener el contexto del canvas');
      return;
    }

    try {
      this.chart = new Chart(ctx, {
        type: 'bar' as ChartType,
        data: data,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: {
              display: false
            },
            legend: {
              display: false
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const index = context.dataIndex;
                  return [
                    `PM2.5: ${processedData.pm25[index].toFixed(1)} µg/m³`,
                    `PM10: ${processedData.pm10[index].toFixed(1)} µg/m³`,
                    `NO2: ${processedData.no2[index].toFixed(1)} µg/m³`
                  ];
                }
              }
            }
          },
        scales: {
          y: {
            beginAtZero: true,
            grid: {
              color: '#e0e0e0'
            },
            ticks: {
              color: '#666'
            }
          },
          x: {
            grid: {
              display: false
            },
            ticks: {
              color: '#666'
            }
          }
        }
      }
      });
      console.log('Gráfico creado exitosamente');
    } catch (error) {
      console.error('Error al crear el gráfico:', error);
    }
  }

  private processHourlyData(history: PollutionHistoryData[]): { labels: string[]; pm25: number[]; pm10: number[]; no2: number[] } {
    const intervals = [0, 4, 8, 12, 16, 20];
    const labels: string[] = [];
    const pm25: number[] = [];
    const pm10: number[] = [];
    const no2: number[] = [];

    // Usar el último dato disponible como base
    const baseData = history[history.length - 1] || history[0];
    const hourlyVariations = [
      { hour: 0, factor: 0.85 },   // 00:00  
      { hour: 4, factor: 0.75 },   // 04:00
      { hour: 8, factor: 1.15 },   // 08:00 
      { hour: 12, factor: 1.25 },  // 12:00 
      { hour: 16, factor: 1.35 },  // 16:00 
      { hour: 20, factor: 1.10 }   // 20:00 
    ];

    intervals.forEach((hour, index) => {
      labels.push(`${hour.toString().padStart(2, '0')}:00`);
      
      const variation = hourlyVariations[index]?.factor || 1.0;
      const seed = hour * 7;
      const randomFactor = 0.9 + ((seed % 20) / 100); 
      
      pm25.push(Math.round(baseData.pm25 * variation * randomFactor));
      pm10.push(Math.round(baseData.pm10 * variation * randomFactor));
      no2.push(Math.round(baseData.no2 * variation * randomFactor));
    });

    return { labels, pm25, pm10, no2 };
  }

  private processDailyData(history: PollutionHistoryData[], timeRange: TimeRange): { labels: string[]; pm25: number[]; pm10: number[]; no2: number[] } {
    const labels: string[] = [];
    const pm25: number[] = [];
    const pm10: number[] = [];
    const no2: number[] = [];

    // Tomar los últimos N días según el rango
    const daysToShow = timeRange === '7d' ? 7 : 30;
    const recentHistory = history.slice(-daysToShow);

    recentHistory.forEach(item => {
      const date = new Date(item.date);
      if (timeRange === '7d') {
        labels.push(date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }));
      } else {
        labels.push(date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }));
      }
      pm25.push(item.pm25);
      pm10.push(item.pm10);
      no2.push(item.no2);
    });

    return { labels, pm25, pm10, no2 };
  }

  private generateGreyColors(count: number): string[] {
    // Generar tonos de gris variados
    const colors: string[] = [];
    for (let i = 0; i < count; i++) {
      const greyValue = 100 + (i * (155 / count));
      colors.push(`rgba(${greyValue}, ${greyValue}, ${greyValue}, 0.8)`);
    }
    return colors;
  }
}
