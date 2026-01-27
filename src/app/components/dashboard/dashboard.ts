import { Component, OnInit, computed } from '@angular/core';
import { Trafico } from '../trafico/trafico';
import { ApiService } from '../../service/api-service.service';

@Component({
  selector: 'app-dashboard',
  imports: [Trafico],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit {
  readonly airQuality = computed(() => this.api.airQuality());
  readonly weather = computed(() => this.api.weather());

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.api.loadValenciaData();
  }
}


