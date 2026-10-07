import test from 'node:test';
import assert from 'node:assert/strict';

test('Regras de Negócio e Cálculos Determinísticos do Agente Pedro', async (t) => {
  await t.test('1. Configuração padrão do Pomodoro (25min foco / 5min pausa)', () => {
    const focusMinutes = 25;
    const breakMinutes = 5;
    assert.equal(focusMinutes * 60, 1500, '25 minutos devem equivaler a 1500 segundos');
    assert.equal(breakMinutes * 60, 300, '5 minutos de pausa devem equivaler a 300 segundos');
  });

  await t.test('2. Blindagem de cálculo de tempo via Timestamps', () => {
    const now = 1700000000000;
    const durationSeconds = 1500;
    const targetTimestamp = now + durationSeconds * 1000;

    // Simula 10 segundos transcorridos com precisão absoluta
    const later = now + 10000;
    const diffMs = targetTimestamp - later;
    const remaining = Math.max(0, Math.ceil(diffMs / 1000));

    assert.equal(remaining, 1490, 'Restante deve ser 1490 segundos');
  });

  await t.test('3. Conversão e modelagem financeira determinística em centavos', () => {
    const formatCentsToBRL = (cents) => {
      const isNegative = cents < 0;
      const abs = Math.abs(cents);
      const reais = (abs / 100).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return `${isNegative ? '-' : ''}R$ ${reais}`;
    };

    assert.equal(formatCentsToBRL(1050), 'R$ 10,50');
    assert.equal(formatCentsToBRL(0), 'R$ 0,00');
    assert.equal(formatCentsToBRL(-25000), '-R$ 250,00');
    assert.equal(formatCentsToBRL(124000), 'R$ 1.240,00');
  });
});
