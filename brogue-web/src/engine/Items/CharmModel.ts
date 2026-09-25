/** BrogueCE PowerTables.c and GlobalsBrogue.c:729-741. Values are 16-bit fixpt. */
const FP = 65536;
type Charm = 'charm_of_health' | 'charm_of_protection' | 'charm_of_speed'
    | 'charm_of_fire_immunity' | 'charm_of_invisibility' | 'charm_of_telepathy';
const TABLE: Record<Charm, { duration: number; increment: 1 | 1.2 | 1.25; recharge: number; base: number }> = {
    charm_of_health: { duration: 3, increment: 1, recharge: 2500, base: 55 },
    charm_of_protection: { duration: 20, increment: 1, recharge: 1000, base: 60 },
    charm_of_speed: { duration: 7, increment: 1.2, recharge: 800, base: 65 },
    charm_of_fire_immunity: { duration: 10, increment: 1.25, recharge: 800, base: 60 },
    charm_of_invisibility: { duration: 5, increment: 1.2, recharge: 800, base: 65 },
    charm_of_telepathy: { duration: 25, increment: 1.25, recharge: 800, base: 65 },
};
export function isCharmKind(id: string | undefined): id is Charm { return !!id && id in TABLE; }

// Math.c:272-287: retain the fractional error through each multiply, then round.
function fpPow(base: number, exponent: number): number {
    let result = FP, error = 0;
    for (let i = 0; i < exponent; i++) {
        const product = result * base + Math.trunc(error * base / FP);
        error = product % FP;
        result = Math.trunc(product / FP);
    }
    return result + (error >= FP / 2 ? 1 : 0);
}

export function charmEffectDuration(id: Charm, enchant: number): number {
    const { duration, increment } = TABLE[id];
    const index = Math.max(0, Math.min(49, Math.trunc(enchant) - 1));
    // GlobalsBase.c contains pre-rounded lookup tables, rather than fp_pow.
    const multiplier = increment === 1 ? FP : increment === 1.2
        ? POW_120[index]! : POW_125[index]!;
    return Math.trunc(duration * multiplier / FP);
}
export function charmRechargeDelay(id: Charm, enchant: number): number {
    const level = Math.max(1, Math.min(50, Math.trunc(enchant)));
    const row = TABLE[id];
    const base = Math.trunc(FP * row.base / 100);
    return Math.max(1, charmEffectDuration(id, level) + Math.trunc(row.recharge * fpPow(base, level) / FP));
}
export function charmHealing(enchant: number): number { return Math.max(0, Math.min(100, Math.trunc(20 * enchant))); }
export function charmProtection(enchant: number): number {
    const index = Math.max(0, Math.min(50, Math.trunc(enchant) - 1));
    return Math.trunc(150 * POW_PROTECTION[index]! / FP);
}

const POW_120 = [78643,94371,113246,135895,163074,195689,234827,281792,338151,405781,486937,584325,701190,841428,1009714,1211657,1453988,1744786,2093744,2512492,3014991,3617989,4341587,5209905,6251886,7502263,9002716,10803259,12963911,15556694,18668032,22401639,26881967,32258360,38710033,46452039,55742447,66890937,80269124,96322949,115587539,138705047,166446056,199735268,239682321,287618785,345142543,414171051,497005262,596406314,715687577];
const POW_125 = [81920,102400,128000,160000,200000,250000,312500,390625,488281,610351,762939,953674,1192092,1490116,1862645,2328306,2910383,3637978,4547473,5684341,7105427,8881784,11102230,13877787,17347234,21684043,27105054,33881317,42351647,52939559,66174449,82718061,103397576,129246970,161558713,201948391,252435489,315544362,394430452,493038065,616297582,770371977,962964972,1203706215,1504632769,1880790961,2350988701,2938735877,3673419846,4591774807,5739718509];
const POW_PROTECTION = [65536,88473,119439,161243,217678,293865,396718,535570,723019,976076,1317703,1778899,2401514,3242044,4376759,5908625,7976644,10768469,14537434,19625536,26494473,35767539,48286178,65186341,88001560,118802106,160382844,216516839,292297733,394601940,532712620,719162037,970868750,1310672812,1769408297,2388701201,3224746621,4353407939,5877100717,7934085969,10711016058,14459871678,19520826766,26353116134,35576706781,48028554155,64838548109,87532039948,118168253930,159527142806,215361642788];
