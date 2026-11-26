import zonaHoraria from './zona-horaria.global-setup';
import { apartarOperacion } from './operacion-legada';

export default async function globalSetup(): Promise<void> {
  zonaHoraria();
  await apartarOperacion();
}
