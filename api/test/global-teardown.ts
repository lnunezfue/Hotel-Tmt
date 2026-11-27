import { devolverOperacion } from './operacion-legada';

export default async function globalTeardown(): Promise<void> {
  await devolverOperacion();
}
