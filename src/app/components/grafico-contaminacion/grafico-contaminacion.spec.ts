import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GraficoContaminacion } from './grafico-contaminacion';

describe('GraficoContaminacion', () => {
  let component: GraficoContaminacion;
  let fixture: ComponentFixture<GraficoContaminacion>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GraficoContaminacion]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GraficoContaminacion);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
