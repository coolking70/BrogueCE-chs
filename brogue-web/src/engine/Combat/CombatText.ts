import { attackVerb } from './AttackVerbs';

export type AttackCircumstance = 'none' | 'zero' | 'lunge' | 'paralyzed' | 'asleep' | 'sneak' | 'helpless';
export interface CombatantText {
    player: boolean;
    name: string;
    visible: boolean;
    ally?: boolean;
    typeId: string;
    unarmed?: boolean;
    inanimate?: boolean;
    gender?: 'male' | 'female';
}
export interface CombatTextEvent {
    attacker: CombatantText;
    defender: CombatantText;
    hit: boolean;
    damage: number;
    percentile: number;
    lethal: boolean;
    circumstance?: AttackCircumstance;
    hallucinating?: boolean;
}
export interface CombatTextOptions {
    showDamage?: boolean;
    /** All locale/state lookup stays at the call site: this formatter is pure. */
    translate: (key: string, english: string) => string | undefined;
}

/** CE Combat.c:1290-1397,1453-1463. No weapon names, RNG or world writes. */
export function formatCombatText(event: CombatTextEvent, options: CombatTextOptions): string {
    // i18next can return undefined before initialization (e.g. headless bolts).
    const t = (key: string, english: string): string => options.translate(key, english) ?? english;
    const { attacker: a, defender: d } = event;
    if (!a.visible && !d.visible) {
        return event.lethal
            ? d.inanimate
                ? t('hear_destroyed', 'you hear something get destroyed in combat')
                : t('hear_death', 'you hear something die in combat')
            : t('hear_combat', 'you hear combat in the distance');
    }
    const name = (c: CombatantText): string => c.player ? t('you', 'you')
        : !c.visible ? t('something', 'something')
        : (c.ally ? t('your', 'your {{name}}') : t('the', 'the {{name}}')).replace('{{name}}', c.name);
    const subject = d.player ? 'you' : !d.visible ? 'it' : d.gender === 'male' ? 'he' : d.gender === 'female' ? 'she' : 'it';
    const object = d.player ? 'you' : !d.visible ? 'it' : d.gender === 'male' ? 'him' : d.gender === 'female' ? 'her' : 'it';
    const possessive = (c: CombatantText) => c.player ? 'your' : !c.visible ? 'its' : c.gender === 'male' ? 'his' : c.gender === 'female' ? 'her' : 'its';
    const circumstance = event.circumstance ?? 'none';
    let verb: string;
    if (!event.hit) verb = a.player ? t('miss', 'miss') : t('misses', 'misses');
    else if (event.lethal) verb = d.inanimate ? t('destroyed', 'destroyed')
        : ['lunge', 'paralyzed', 'asleep', 'sneak'].includes(circumstance)
            ? t('dispatched', 'dispatched') : t('defeated', 'defeated');
    else {
        const english = attackVerb(a.typeId, event.percentile, a.unarmed,
            !a.player && (!!event.hallucinating || !a.visible));
        verb = t('verb.' + english, english).replace('$HISHER', possessive(a));
    }
    const clauses: Record<AttackCircumstance, string> = {
        none: '', zero: a.player ? ' but do no damage' : ' but does no damage',
        lunge: ' with a vicious lunge attack',
        paralyzed: ` while ${subject} ${d.player ? 'are' : 'is'} paralyzed`,
        asleep: ` in ${possessive(d)} sleep`, sneak: `, catching ${object} unaware`,
        helpless: ` while ${subject} dangle${d.player ? '' : 's'} helplessly`,
    };
    const clauseKey = circumstance === 'zero' ? (a.player ? 'zero_player' : 'zero_monster')
        : (circumstance === 'paralyzed' || circumstance === 'helpless') && d.player
            ? circumstance + '_player' : circumstance;
    const clause = !event.hit || circumstance === 'none' ? '' : t('clause.' + clauseKey, clauses[circumstance]);
    let sentence = t('sentence', '{{attacker}} {{verb}} {{defender}}{{clause}}')
        .replace('{{attacker}}', name(a)).replace('{{verb}}', verb)
        .replace('{{defender}}', name(d)).replace('{{clause}}', clause);
    if (options.showDamage && event.hit) sentence += t('damage', ' ({{damage}} damage)').replace('{{damage}}', String(event.damage));
    return sentence;
}
