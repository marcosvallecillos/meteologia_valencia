import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Trafico } from './trafico';

describe('Trafico', () => {
  let component: Trafico;
  let fixture: ComponentFixture<Trafico>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Trafico]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Trafico);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
