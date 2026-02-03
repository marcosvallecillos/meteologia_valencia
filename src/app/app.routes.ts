import { Routes } from '@angular/router';
import { MainComponent } from './views/main/main';
import { Leaflet } from './components/leaflet/leaflet';

export const routes: Routes = [
  { path: '', redirectTo: '/main', pathMatch: 'full' },
  { path: 'main', component: MainComponent },
  { path: 'index', component: MainComponent },
  { path: 'leaflet', component: Leaflet }
];
