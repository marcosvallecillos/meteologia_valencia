import { Component, AfterViewInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import * as L from 'leaflet';
import 'leaflet.heat';
import { ApiService, PollutionHeatmapPoint } from '../../service/api-service.service';

@Component({
  selector: 'app-leaflet',
  imports: [],
  templateUrl: './leaflet.html',
  styleUrl: './leaflet.css',
})
export class Leaflet implements AfterViewInit, OnDestroy {
  @ViewChild('legendContainer', { static: true }) legendContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('mapContainer', { static: false }) mapContainer!: ElementRef<HTMLDivElement>;
  
  private map: L.Map | null = null;
  private heatLayer: any = null;
  private resizeHandler?: () => void;

  constructor(private api: ApiService) {}

  ngAfterViewInit(): void {
    // Esperar a que el DOM esté completamente renderizado y el contenedor tenga dimensiones
    setTimeout(() => {
      this.waitForMapContainer();
    }, 200);
  }

  ngOnDestroy(): void {
    // Remover listener de resize
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }
    
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  /**
   * Espera a que el contenedor del mapa tenga dimensiones válidas antes de inicializar
   */
  private waitForMapContainer(): void {
    const mapElement = document.getElementById('map');
    
    if (!mapElement) {
      console.error('No se encontró el elemento del mapa');
      return;
    }

    // Verificar que el contenedor tenga dimensiones válidas
    const checkDimensions = () => {
      const rect = mapElement.getBoundingClientRect();
      const hasDimensions = rect.width > 0 && rect.height > 0;
      
      if (hasDimensions) {
        this.initializeMap();
      } else {
        // Reintentar después de un breve delay
        setTimeout(checkDimensions, 100);
      }
    };

    checkDimensions();
  }

  private async initializeMap(): Promise<void> {
    console.log('initializeMap');
    
    const mapElement = document.getElementById('map');
    if (!mapElement) {
      console.error('No se encontró el elemento del mapa');
      return;
    }

    // Verificar dimensiones una vez más antes de inicializar
    const rect = mapElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      console.error('El contenedor del mapa no tiene dimensiones válidas');
      return;
    }

    // Definir los límites de Valencia para que el mapa muestre toda el área
    const valenciaBounds: L.LatLngBoundsExpression = [
      [39.42, -0.42],  // Suroeste
      [39.52, -0.32]   // Noreste
    ];
    
    try {
      // Inicializar mapa centrado en Valencia con zoom para mostrar toda el área
      this.map = L.map('map', {
        center: [39.47, -0.37],
        zoom: 11,
        minZoom: 10,
        maxZoom: 15,
        maxBounds: valenciaBounds,
        maxBoundsViscosity: 1.0,
        preferCanvas: false // Evitar problemas con canvas
      });
  
      // Esperar a que el mapa esté completamente inicializado
      this.map.whenReady(() => {
        // Capa base de OpenStreetMap con opacidad muy baja para que se vea principalmente el heatmap
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '',
          maxZoom: 18,
          opacity: 0.2  // Hacer el mapa base casi invisible
        }).addTo(this.map!);
        
        // Ajustar la vista para mostrar toda Valencia
        this.map!.fitBounds(valenciaBounds, { padding: [20, 20] });
        
        // Invalidar el tamaño del mapa para asegurar que tenga dimensiones correctas
        setTimeout(() => {
          if (this.map) {
            this.map.invalidateSize();
          }
        }, 100);
        
        // Inicializar el heatmap después de que el mapa esté listo
        this.loadHeatmapData();
        
        // Manejar redimensionamiento de la ventana
        this.resizeHandler = () => {
          if (this.map) {
            setTimeout(() => {
              this.map!.invalidateSize();
            }, 100);
          }
        };
        window.addEventListener('resize', this.resizeHandler);
      });
    } catch (error) {
      console.error('Error al inicializar el mapa:', error);
    }
  }

  /**
   * Carga los datos del heatmap después de que el mapa esté inicializado
   */
  private async loadHeatmapData(): Promise<void> {
    if (!this.map) {
      console.error('El mapa no está inicializado');
      return;
    }
  
    try {
      // Obtener datos de contaminación
      const points = await this.api.fetchPollutionHeatmapValencia();
      
      if (points.length === 0) {
        console.warn('No se encontraron datos de contaminación');
        if (this.map) {
          this.showNoDataMessage(this.map);
        }
        return;
      }

      console.log(`Datos cargados: ${points.length} estaciones`, points);

      // Convertir datos al formato requerido por leaflet.heat
      const heatData: [number, number, number][] = points
        .filter((p: PollutionHeatmapPoint) => p.lat && p.lng && p.value > 0) // Filtrar datos válidos
        .map((p: PollutionHeatmapPoint) => [
          p.lat,
          p.lng,
          this.normalizeIntensity(p.value)
        ]);

      if (heatData.length === 0) {
        console.warn('No hay datos válidos para mostrar');
        return;
      }

      // Asegurarse de que el mapa tenga dimensiones válidas antes de crear el heatmap
      const mapSize = this.map.getSize();
      if (mapSize.x === 0 || mapSize.y === 0) {
        console.warn('El mapa no tiene dimensiones válidas, esperando...');
        setTimeout(() => this.loadHeatmapData(), 200);
        return;
      }

      // Remover heatmap anterior si existe
      if (this.heatLayer && this.map) {
        this.map.removeLayer(this.heatLayer);
      }

      // Crear capa de calor con configuración mejorada para ocupar toda Valencia
      try {
        this.heatLayer = (L as any).heatLayer(heatData, {
          radius: 80,           // Radio de influencia muy amplio para cubrir toda el área
          blur: 40,             // Difuminado más amplio
          maxZoom: 15,          // Zoom máximo donde se muestra el efecto
          max: 1.0,             // Valor máximo de intensidad
          minOpacity: 1,        // Opacidad mínima más alta para mejor visualización
          gradient: {           // Gradiente de colores más suave y realista
            0.0: '#00ff00',     // Verde (buena calidad)
            0.15: '#80ff00',   // Verde-amarillo
            0.3: '#ffff00',    // Amarillo (moderada)
            0.45: '#ffcc00',   // Amarillo-naranja
            0.5: '#ff9900',    // Naranja (no saludable para grupos sensibles)
            0.65: '#ff6600',   // Naranja-rojo
            0.7: '#ff0000',    // Rojo (no saludable)
            0.85: '#cc0066',   // Rojo-púrpura
            0.9: '#990099',    // Púrpura (muy no saludable)
            0.95: '#660066',   // Púrpura oscuro
            1.0: '#330033'     // Marrón oscuro (peligroso)
          }
        });

        if (this.map && this.heatLayer) {
          this.heatLayer.addTo(this.map);
        }

        // Añadir marcadores con información en cada estación
        if (this.map) {
          this.addStationMarkers(this.map, points);
        }

        // Añadir leyenda
        if (this.map) {
          this.addLegend(this.map);
        }
      } catch (heatError) {
        console.error('Error al crear el heatmap:', heatError);
        // Si hay un error con el heatmap, al menos mostrar los marcadores
        if (this.map) {
          this.addStationMarkers(this.map, points);
          this.addLegend(this.map);
        }
      }

    } catch (error) {
      console.error('Error al cargar el mapa de calor:', error);
    }
  }

  /**
   * Normaliza los valores PM2.5 a una escala de 0-1
   * Basado en el índice de calidad del aire (AQI)
   */
  private normalizeIntensity(pm25Value: number): number {
    const thresholds = {
      good: 12,
      moderate: 35.4,
      unhealthySensitive: 55.4,
      unhealthy: 150.4,
      veryUnhealthy: 250.4,
      hazardous: 500
    };

    // Normalizar a escala 0-1
    if (pm25Value <= thresholds.good) {
      return pm25Value / thresholds.good * 0.2;
    } else if (pm25Value <= thresholds.moderate) {
      return 0.2 + (pm25Value - thresholds.good) / (thresholds.moderate - thresholds.good) * 0.2;
    } else if (pm25Value <= thresholds.unhealthySensitive) {
      return 0.4 + (pm25Value - thresholds.moderate) / (thresholds.unhealthySensitive - thresholds.moderate) * 0.2;
    } else if (pm25Value <= thresholds.unhealthy) {
      return 0.6 + (pm25Value - thresholds.unhealthySensitive) / (thresholds.unhealthy - thresholds.unhealthySensitive) * 0.2;
    } else if (pm25Value <= thresholds.veryUnhealthy) {
      return 0.8 + (pm25Value - thresholds.unhealthy) / (thresholds.veryUnhealthy - thresholds.unhealthy) * 0.1;
    } else {
      return Math.min(0.9 + (pm25Value - thresholds.veryUnhealthy) / (thresholds.hazardous - thresholds.veryUnhealthy) * 0.1, 1.0);
    }
  }

  /**
   * Añade marcadores en las estaciones de medición
   */
  private addStationMarkers(map: L.Map, points: PollutionHeatmapPoint[]) {
    
    const mainStations = points.slice(0, Math.min(18, points.length));
    
    mainStations.forEach((point, index) => {
      const qualityLevel = this.getAirQualityLevel(point.value);
      
      // Crear marcador más visible y atractivo
      const marker = L.circleMarker([point.lat, point.lng], {
        radius: 8,
        fillColor: qualityLevel.color,
        color: '#ffffff',
        weight: 3,
        opacity: 1,
        fillOpacity: 0.9
      });

      // Agregar animación al pasar el mouse
      marker.on('mouseover', function(this: L.CircleMarker) {
        this.setStyle({
          radius: 10,
          weight: 4
        });
      });
      
      marker.on('mouseout', function(this: L.CircleMarker) {
        this.setStyle({
          radius: 8,
          weight: 3
        });
      });

      // Popup mejorado con más información
      // Popup para mostrar la estacion
      marker.bindPopup(`
        <div style="text-align: center; min-width: 150px;">
          <div style="font-size: 16px; font-weight: bold; margin-bottom: 8px;">
            Estación ${index + 1}
          </div>
          <div style="font-size: 20px; font-weight: bold; color: ${qualityLevel.color}; margin-bottom: 5px;">
            ${point.value.toFixed(1)} µg/m³
          </div>
          <div style="font-size: 12px; color: #666; margin-bottom: 5px;">
            PM2.5
          </div>
          <div style="padding: 5px; background: ${qualityLevel.color}20; border-radius: 4px; margin-top: 5px;">
            <span style="color: ${qualityLevel.color}; font-weight: bold; font-size: 13px;">
              ${qualityLevel.label}
            </span>
          </div>
        </div>
      `, {
        className: 'custom-popup'
      });

      marker.addTo(map);
    });
  }

  /**
   * Determina el nivel de calidad del aire según PM2.5
   */
  private getAirQualityLevel(pm25: number): { label: string; color: string } {
    if (pm25 <= 12) {
      return { label: 'Buena', color: '#00ff00' };
    } else if (pm25 <= 35.4) {
      return { label: 'Moderada', color: '#ffff00' };
    } else if (pm25 <= 55.4) {
      return { label: 'No saludable (sensibles)', color: '#ff9900' };
    } else if (pm25 <= 150.4) {
      return { label: 'No saludable', color: '#ff0000' };
    } else if (pm25 <= 250.4) {
      return { label: 'Muy no saludable', color: '#990099' };
    } else {
      return { label: 'Peligrosa', color: '#660000' };
    }
  }

  /**
   * Añade leyenda al mapa usando el elemento del template
   */
  private addLegend(map: L.Map) {
    if (!this.legendContainer?.nativeElement) {
      console.warn('El contenedor de la leyenda no está disponible');
      return;
    }

    const legend = new L.Control({ position: 'bottomright' });

    legend.onAdd = () => {
      // Clonar el elemento del template para que Leaflet pueda manejarlo
      const legendElement = this.legendContainer.nativeElement.cloneNode(true) as HTMLElement;
      // Asegurar que el elemento clonado sea visible
      legendElement.style.display = 'block';
      return legendElement;
    };

    legend.addTo(map);
  }

  /**
   * Muestra mensaje cuando no hay datos disponibles
   */
  private showNoDataMessage(map: L.Map) {
    const popup = L.popup()
      .setLatLng([39.4699, -0.3763])
      .setContent('<strong>No hay datos de contaminación disponibles</strong>')
      .openOn(map);
  }
}