import { PALETTES } from '../levels/schema';
import { THEME_NAMES } from '../levels/themes';
import type { Field } from './fields';

// Builds property inputs for an object. `onChange(key, undefined)` means "remove this optional field".

type Obj = Record<string, unknown>;

const DEFAULT_COLOR = '#b8bfcc';

function numberInput(value: number | undefined, step: number, onValue: (v: number | undefined) => void) {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = String(step);
  input.value = value === undefined ? '' : String(value);
  input.addEventListener('change', () => {
    const v = input.valueAsNumber;
    onValue(input.value === '' || !Number.isFinite(v) ? undefined : v);
  });
  return input;
}

export function buildForm(container: HTMLElement, obj: Obj, fields: Field[], onChange: (key: string, value: unknown) => void) {
  container.replaceChildren();
  for (const f of fields) {
    const row = document.createElement('label');
    row.className = 'field';
    const name = document.createElement('span');
    name.textContent = f.label ?? f.key;
    row.append(name);
    const value = obj[f.key];

    switch (f.kind) {
      case 'vec3': {
        const vec = (value as number[] | undefined) ?? [0, 0, 0];
        const group = document.createElement('span');
        group.className = 'vec3';
        vec.forEach((n, i) => group.append(numberInput(n, f.step ?? 0.5, (v) => {
          const next = [...vec];
          next[i] = v ?? 0;
          onChange(f.key, next);
        })));
        row.append(group);
        break;
      }
      case 'number':
        row.append(numberInput(value as number | undefined, f.step ?? 0.5, (v) => {
          if (v === undefined && !f.optional) return;
          onChange(f.key, v);
        }));
        if (f.optional) row.title = 'Leave empty for the default';
        break;
      case 'bool': {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = value === true;
        input.addEventListener('change', () => onChange(f.key, input.checked ? true : f.optional ? undefined : false));
        row.append(input);
        break;
      }
      case 'palette': {
        const select = document.createElement('select');
        for (const p of ['', ...PALETTES]) {
          const opt = document.createElement('option');
          opt.value = p;
          opt.textContent = p || '(default)';
          select.append(opt);
        }
        select.value = (value as string | undefined) ?? '';
        select.addEventListener('change', () => onChange(f.key, select.value || undefined));
        row.append(select);
        break;
      }
      case 'kind': {
        const select = document.createElement('select');
        select.append(new Option('race (goal + route)', 'race'), new Option('arena (party modes)', 'arena'));
        select.value = (value as string | undefined) ?? 'race';
        select.addEventListener('change', () => onChange(f.key, select.value));
        row.append(select);
        break;
      }
      case 'theme': {
        const select = document.createElement('select');
        for (const t of THEME_NAMES) select.append(new Option(t, t));
        select.value = (value as string | undefined) ?? 'meadow';
        select.addEventListener('change', () => onChange(f.key, select.value));
        row.append(select);
        break;
      }
      case 'color': {
        const input = document.createElement('input');
        input.type = 'color';
        input.value = (value as string | undefined) ?? DEFAULT_COLOR;
        input.addEventListener('change', () => onChange(f.key, input.value));
        row.append(input);
        break;
      }
      case 'text': {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = (value as string | undefined) ?? '';
        input.addEventListener('change', () => onChange(f.key, input.value));
        row.append(input);
        break;
      }
    }
    container.append(row);
  }
}
