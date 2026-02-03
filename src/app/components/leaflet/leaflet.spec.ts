import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Leaflet } from './leaflet';

describe('Leaflet', () => {
  let component: Leaflet;
  let fixture: ComponentFixture<Leaflet>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Leaflet]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Leaflet);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
