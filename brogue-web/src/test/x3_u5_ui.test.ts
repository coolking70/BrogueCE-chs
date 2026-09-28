import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRenderer, nextTick, type Component } from 'vue';
import * as Vue from 'vue';
import * as translation from 'i18next-vue';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import zhCN from '../locales/zh_CN.json';
import { activeGame as game } from '../engine/Core/Game';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { TerrainType as T } from '../engine/Map/Grid';

// Render the real SFCs with Vue's host renderer: click their emitted handlers,
// including dispatch and item-command recording, without source-shape assertions.
type Node = { type: string; text: string; props: Record<string, any>; children: Node[]; parent: Node | null };
const node = (type: string, text = ''): Node => Object.assign({ type, text, props: {}, children: [], parent: null }, {
    addEventListener() {}, removeEventListener() {}, tagName: type.toUpperCase(),
});
const renderer = createRenderer<Node, Node>({
    createElement: tag => node(tag), createText: text => node('#text', text), createComment: text => node('#comment', text),
    insert(child, parent, anchor) {
        if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
        child.parent = parent; const index = anchor ? parent.children.indexOf(anchor) : -1;
        parent.children.splice(index < 0 ? parent.children.length : index, 0, child);
    },
    remove(child) { child.parent?.children.splice(child.parent.children.indexOf(child), 1); child.parent = null; },
    setText: (n, text) => { n.text = text; }, setElementText: (n, text) => { n.text = text; n.children = []; },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
    patchProp: (n, key, _old, value) => { n.props[key] = value; },
});
function all(n: Node): Node[] { return [n, ...n.children.flatMap(all)]; }
function text(n: Node): string { return n.type === '#comment' ? '' : n.text + n.children.map(text).join(''); }
let unmount: (() => void) | undefined;
let CommandBar: Component, Inventory: Component, DPad: Component;
let input: typeof import('../engine/Input').inputManager;
const pollers = new Set<() => void>();
beforeAll(async () => {
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {}, clearTimeout() {}, clearInterval() {} });
    vi.stubGlobal('document', { activeElement: null });
    await i18next.init({ lng: 'zh_CN', fallbackLng: false, resources: { zh_CN: { translation: zhCN } }, initImmediate: false });
    input = (await import('../engine/Input')).inputManager;
    // Vitest's node SFC transform is SSR-only. Compile these same production
    // scripts/templates for the client so Vue installs their real click handlers.
    const modules: Record<string, unknown> = {
        vue: Vue, 'i18next-vue': translation, i18next,
        '../engine/Core/Game': { activeGame: game },
        '../ui/commands': await import('../ui/commands'),
        '../types': await import('../types'),
        '../engine/Items/Item': await import('../engine/Items/Item'),
        '../engine/Items/ItemLoader': { ItemLoader },
        '../engine/Systems/Logger': await import('../engine/Systems/Logger'),
        '../engine/UI/DetailGenerator': await import('../engine/UI/DetailGenerator'),
        '../engine/UI/ItemDetailContext': await import('../engine/UI/ItemDetailContext'),
    };
    const compile = (file: string): Component => {
        const { descriptor } = parse(readFileSync(new URL(`../components/${file}`, import.meta.url), 'utf8'));
        const script = compileScript(descriptor, { id: file, inlineTemplate: true });
        const code = ts.transpileModule(script.content, { compilerOptions: {
            target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
        } }).outputText;
        const exports: any = {};
        new Function('require', 'exports', 'setInterval', 'clearInterval', code)((key: string) => {
            if (!(key in modules)) throw new Error(`Unresolved component import: ${key}`);
            return modules[key];
        }, exports, (callback: () => void) => { pollers.add(callback); return callback; }, (callback: () => void) => pollers.delete(callback));
        return exports.default;
    };
    CommandBar = compile('CommandBar.vue'); Inventory = compile('InventoryOverlay.vue'); DPad = compile('DPad.vue');
});
afterEach(() => { unmount?.(); unmount = undefined; pollers.clear(); });
async function mount(component: Component) {
    const root = node('root');
    const app = renderer.createApp(component, { mode: 'portrait' }); app.use(I18NextVue, { i18next });
    app.mount(root); unmount = () => app.unmount(); await tick(); return root;
}
async function tick() { for (const poll of pollers) poll(); await nextTick(); }
function setup() {
    game.startNewGame({ seed: 33005, mode: 'test' }); game.animationEnabled = false;
    game.monsters = []; game.dormantMonsters = []; game.items = [];
    input.setCallback((action, data) => game.executeCommand(action, data));
}
function find(root: Node, predicate: (n: Node) => boolean) {
    const found = all(root).find(predicate); expect(found).toBeDefined(); return found!;
}

describe('X3-U5 real component command wiring', () => {
    it('touch bar sends long commands/stair direction and labels x as exploration', async () => {
        setup(); const root = await mount(CommandBar);
        expect(all(root).some(n => n.props['data-action'] === 'examine')).toBe(false);
        const explore = find(root, n => n.props['data-action'] === 'auto_explore');
        expect(text(explore)).toBe('探索x'); explore.props.onClick();
        expect(game.recordedInputEvents[game.recordedInputEvents.length - 1]!.action).toBe('auto_explore');
        for (const [action, direction] of [['auto_rest', undefined], ['search_long', undefined], ['travel_stairs', 'up'], ['travel_stairs', 'down']]) {
            const button = find(root, n => n.props['data-action'] === action && n.props['data-direction'] === direction);
            button.props.onClick(); const event = game.recordedInputEvents[game.recordedInputEvents.length - 1]!;
            expect([event.action, event.data]).toEqual([action, direction ?? null]);
        }
    });
    it('DPad center remains the same pure wait command', async () => {
        setup(); const root = await mount(DPad);
        find(root, n => n.type === 'button' && text(n) === '·').props.onClick({ detail: 0 });
        expect(game.recordedInputEvents[game.recordedInputEvents.length - 1]!.action).toBe('wait');
    });
    it.each(['equip', 'unequip', 'drop', 'call'] as const)('%s preselection renders a prompt and clicking an eligible item executes that operation', async operation => {
        setup(); const root = await mount(Inventory);
        const item = operation === 'call'
            ? ItemLoader.spawnPotion('potion_of_healing', -1, -1)!
            : game.player.inventory.items.find(i => i === game.player.equippedWeapon)!;
        if (operation === 'call') game.player.inventory.addItem(item);
        if (operation === 'equip') game.player.equippedWeapon = null;
        game.executeCommand('inventory_action', operation); await tick();
        expect(game.isInventoryOpen).toBe(true);
        expect(text(root)).toContain((zhCN as Record<string, string>)[`inventory.prompt.${operation}`]);
        const row = find(root, n => n.props.class?.split(' ').includes('item-row') && text(n).startsWith(item.inventoryLetter!));
        row.props.onClick(); await tick();
        if (operation === 'call') {
            const field = find(root, n => n.type === 'input');
            field.props['onUpdate:modelValue']('test title');
            find(root, n => n.type === 'button' && text(n) === zhCN['Name it']).props.onClick(); await tick();
            expect(ItemLoader.callTitles.get((item as any).consumableId)).toBe('test title');
        } else {
            if (operation === 'equip') expect(game.player.equippedWeapon).toBe(item);
            if (operation === 'unequip') expect(game.player.equippedWeapon).toBeNull();
            if (operation === 'drop') expect(game.player.inventory.items).not.toContain(item);
        }
        expect(game.recordedInputEvents.some(e => e.action === 'item:command' && String(e.data).startsWith(`${operation}|`))).toBe(true);
    });
    it('x reaches exploration without opening the nearest monster/item detail', async () => {
        setup();
        // Isolate a visible item with a valid known route, rather than depending
        // on where the generated test level happens to put one.
        const { x, y } = game.player.loc;
        game.grid.setTerrain(x + 1, y, T.FLOOR);
        const cell = game.grid.getCell(x + 1, y)!; cell.isVisible = cell.isExplored = cell.hasMemory = true;
        cell.rememberedLayers = [...cell.layers]; game.items.push(ItemLoader.spawnFood('ration_of_food', x + 1, y)!);
        input.triggerAction('auto_explore');
        expect(game.inspectTarget).toBeNull(); expect(game.autoPath.length).toBeGreaterThan(0);
    });
});
