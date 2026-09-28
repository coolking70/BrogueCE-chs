"""Generate an instrumented copy of the unchanged old replay guard in output.
--stack-fix probes the proposed fixture correction without editing the guard.
"""
from pathlib import Path
import sys

source = Path('src/test/x3b_display_recording.test.ts').read_text(encoding='utf-8')
source = source.replace("from './harness'", "from '../../src/test/harness'")
for directory in ['entities', 'data', 'engine']:
    source = source.replace(f"from '../{directory}/", f"from '../../src/{directory}/")
old = '''        expect(item, id).toBeDefined(); walk(g, item.loc, act);
        if (!g.player.inventory.items.includes(item)) act('pickup');
        expect(g.player.inventory.items).toContain(item); return item;'''
fixed = '''        expect(item, id).toBeDefined();
        // X4-R3: a naturally collected scroll can merge into a pre-existing
        // stack along this same route. Verify the pickup transaction, then use
        // the surviving pack object; recording/replay comparators stay intact.
        const sameKind = (i: Item) => i.identityId === id || i.consumableId === id;
        const quantity = () => g.player.inventory.items.filter(sameKind).reduce((sum, i) => sum + i.quantity, 0);
        let collected = false;
        const pickupAct = (action: string, data?: unknown) => {
            const before = quantity(), onFloor = g.items.includes(item), amount = item.quantity;
            act(action, data);
            if (onFloor && !g.items.includes(item)) {
                expect(quantity(), `pickup of ${id} preserves the full quantity`).toBe(before + amount);
                collected = true;
            }
        };
        walk(g, item.loc, pickupAct);
        if (g.items.includes(item)) pickupAct('pickup');
        expect(collected, id).toBe(true);
        expect(g.items).not.toContain(item);
        const carried = g.player.inventory.items.find(sameKind)!;
        expect(carried, id).toBeDefined();
        expect(g.player.inventory.items).toContain(carried); return carried;'''
assert source.count(old) == 1
if '--stack-fix' in sys.argv:
    source = source.replace(old, fixed)
else:
    needle = '        expect(g.player.inventory.items).toContain(item); return item;'
    probe = "        writeFileSync('output/x4-r3/replay-collect-'+id+'.json', JSON.stringify({id, depth:g.depth, loc:g.player.loc, target:{id:item.id,kind:item.consumableId??item.identityId,quantity:item.quantity,flags:item.flags,loc:item.loc}, inventory:g.player.inventory.items.map(i=>({id:i.id,kind:i.consumableId??i.identityId,quantity:i.quantity})), targetOnFloor:g.items.includes(item)},null,2)+'\\n');\n"
    source = source.replace(needle, probe + needle)
Path('output/x4-r3/replay-probe.ts').write_text(source, encoding='utf-8', newline='\n')
# Keep the exact candidate text for the proof-gated premise updater.
Path('output/x4-r3/replay-stack-fix.txt').write_text(fixed, encoding='utf-8', newline='\n')
print('Generated replay probe; original guard unchanged')
