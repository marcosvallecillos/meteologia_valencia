import { Component } from '@angular/core';
import { Dashboard } from '../../components/dashboard/dashboard';
import { Trafico } from '../../components/trafico/trafico';
import { GraficoContaminacion } from '../../components/grafico-contaminacion/grafico-contaminacion';

@Component({
  selector: 'app-main',
  imports: [Dashboard
  ],
  templateUrl: './main.html',
  styleUrl: './main.css',
})
export class MainComponent {

}
