import { NEIGHBORHOODS, PLACES, type Neighborhood, type Place } from "./places.js";

/**
 * Fills each place in with plans, units, rents, dates and words from a
 * seeded generator, so every build of the site is the same site. Nothing
 * here reads the clock: dates are relative to TODAY.
 */

/** The site's idea of today; availability dates fall in the three months after it. */
export const TODAY = "2026-10-15";

export interface SeedUnit {
    id: string;
    name: string;
    beds: number;
    baths: number;
    sqft: number;
    rent: number;
    /** "Available now" or an ISO date. */
    available: string;
}

export interface SeedPlan {
    id: string;
    name: string | null;
    beds: number;
    baths: number;
    units: SeedUnit[];
}

export interface SeedListing extends Place {
    unit: string | undefined;
    geo: { lat: number; lng: number };
    phone: string;
    rating: number | null;
    photoCount: number;
    amenities: string[];
    pets: string;
    description: string;
    plans: SeedPlan[];
}

/** mulberry32: a small seeded generator, good enough for fiction. */
function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Rent, by the neighbourhood's pull. */
const HOOD_FACTOR: Record<Neighborhood, number> = {
    "Clarksville": 1.25,
    "Zilker": 1.25,
    "Bouldin Creek": 1.25,
    "Hyde Park": 1.1,
    "Mueller": 1.1,
    "Rosedale": 1.1,
    "East Austin": 1.05,
    "South Lamar": 1.0,
    "North Loop": 1.0,
    "Crestview": 1.0,
    "Riverside": 0.95,
    "West Campus": 1.0,
    "Allandale": 0.95,
    "Brentwood": 0.95,
};

const BASE_RENT = [1150, 1400, 1900, 2600, 3200];
const SQFT: [number, number][] = [[420, 560], [580, 780], [850, 1150], [1200, 1600], [1500, 2000]];
const PLAN_LETTERS = ["S", "A", "B", "C", "D"];

const BUILDING_FEATURES = ["In-unit laundry", "Laundry room on each floor", "Dishwasher", "Covered parking", "Fitness center", "Resort-style pool"];
const BUILDING_EXTRAS = ["Rooftop deck", "Bike storage", "Dog run", "Package lockers", "Balconies", "Co-working lounge", "Courtyard grills", "Controlled access"];
const HOME_FEATURES = ["In-unit laundry", "Dishwasher", "Off-street parking"];
const HOME_EXTRAS = ["Fenced yard", "Hardwood floors", "Central A/C", "Covered porch", "Storage shed", "Quartz counters", "Walk-in closet"];
const PETS = ["Cats welcome", "Cats and small dogs welcome", "Cats and dogs welcome, $35/mo pet rent", "No pets"];
const LANDMARKS = ["the hike-and-bike trail", "the light rail", "the farmers market", "the greenbelt", "campus", "the Drag", "the river"];

const BUILDING_TEMPLATES = [
    (h: string, l: string) => `A ${h} community a short walk from ${l}, with quiet courtyard units and a rooftop that looks west.`,
    (h: string, l: string) => `Mid-rise living in ${h}: tall windows, a shaded courtyard, and ${l} at the end of the block.`,
    (h: string, l: string) => `Renovated in 2024, with new kitchens throughout. Steps from ${l} and the rest of ${h}.`,
    (h: string, l: string) => `Garden-style buildings around a pool, tucked into ${h}. Bus lines and ${l} are nearby.`,
    (h: string, l: string) => `Lofts in a former warehouse at the edge of ${h}, concrete floors and all, near ${l}.`,
];
const HOME_TEMPLATES = [
    (h: string, l: string) => `A quiet ${h} street, a fenced yard, and ${l} ten minutes away on foot.`,
    (_h: string, l: string) => `Updated kitchen and bath, original hardwoods, and a porch that catches the evening breeze. Close to ${l}.`,
    (h: string, l: string) => `Bright corner unit in a small ${h} building, with its own entrance and off-street parking. Near ${l}.`,
    (_h: string, l: string) => `A 1950s bungalow kept simple: two bedrooms, a big pecan tree, and ${l} nearby.`,
];

function pick<T>(r: () => number, items: readonly T[]): T {
    return items[Math.floor(r() * items.length)]!;
}

function between(r: () => number, lo: number, hi: number): number {
    return lo + Math.floor(r() * (hi - lo + 1));
}

function sample<T>(r: () => number, items: readonly T[], count: number): T[] {
    const pool = [...items];
    const out: T[] = [];
    while (out.length < count && pool.length > 0) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]!);
    return out;
}

function isoDaysAfter(days: number): string {
    const d = new Date(`${TODAY}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function availability(r: () => number): string {
    return r() < 0.45 ? "Available now" : isoDaysAfter(between(r, 7, 90));
}

function rentFor(r: () => number, beds: number, hood: Neighborhood): number {
    const base = BASE_RENT[Math.min(beds, 4)]! * HOOD_FACTOR[hood] * (0.88 + r() * 0.24);
    return Math.min(4200, Math.max(1100, Math.round(base / 5) * 5));
}

function sqftFor(r: () => number, beds: number): number {
    const [lo, hi] = SQFT[Math.min(beds, 4)]!;
    return Math.round(between(r, lo, hi) / 10) * 10;
}

function bathsFor(r: () => number, beds: number): number {
    if (beds <= 1) return 1;
    if (beds === 2) return pick(r, [1, 2, 2]);
    return pick(r, [2, 2, 2.5]);
}

function buildingPlans(r: () => number, hood: Neighborhood): SeedPlan[] {
    // Three to six plans: distinct bed counts first, then second plans of the popular sizes.
    const planCount = between(r, 3, 6);
    const bedOptions = [...sample(r, [0, 1, 2, 3], Math.min(planCount, between(r, 3, 4))), ...sample(r, [1, 2, 2], 3)].slice(0, planCount).sort((a, b) => a - b);
    const seen = new Map<number, number>();
    const taken = new Set<string>();
    let floor = 1;
    return bedOptions.map((beds, index) => {
        const nth = (seen.get(beds) ?? 0) + 1;
        seen.set(beds, nth);
        const baths = bathsFor(r, beds);
        const units: SeedUnit[] = [];
        for (let u = 0, n = between(r, 1, 4); u < n; u++) {
            let number = `${floor}${String(between(r, 1, 18)).padStart(2, "0")}`;
            while (taken.has(number)) number = `${floor}${String(between(r, 1, 18)).padStart(2, "0")}`;
            taken.add(number);
            floor = Math.min(floor + 1, 6);
            units.push({ id: `u${number}`, name: `Unit ${number}`, beds, baths, sqft: sqftFor(r, beds), rent: rentFor(r, beds, hood), available: availability(r) });
        }
        return { id: `p${index + 1}`, name: `${PLAN_LETTERS[beds]}${nth}`, beds, baths, units };
    });
}

function homePlan(r: () => number, place: Place): SeedPlan {
    const beds = place.type === "condo" ? between(r, 1, 2) : place.type === "townhome" ? between(r, 2, 3) : between(r, 2, 4);
    const baths = bathsFor(r, beds);
    const rent = rentFor(r, beds, place.hood) + (place.type === "house" ? 300 : 0);
    const unit: SeedUnit = { id: "main", name: "Whole home", beds, baths, sqft: sqftFor(r, beds), rent: Math.min(4200, rent), available: availability(r) };
    return { id: "main", name: null, beds, baths, units: [unit] };
}

function generate(place: Place, index: number, r: () => number): SeedListing {
    const building = place.kind === "building";
    const amenities = building
        ? [...sample(r, BUILDING_FEATURES, between(r, 2, 4)), ...sample(r, BUILDING_EXTRAS, between(r, 1, 3))]
        : [...sample(r, HOME_FEATURES, between(r, 1, 3)), ...sample(r, HOME_EXTRAS, between(r, 1, 3))];
    const template = pick(r, building ? BUILDING_TEMPLATES : HOME_TEMPLATES);
    return {
        ...place,
        unit: place.unit,
        geo: { lat: Number((30.2672 + (r() - 0.5) * 0.12).toFixed(4)), lng: Number((-97.7431 + (r() - 0.5) * 0.12).toFixed(4)) },
        phone: `(512) 555-01${String(index).padStart(2, "0")}`,
        rating: building ? Number((3.4 + r() * 1.5).toFixed(1)) : null,
        photoCount: building ? between(r, 4, 5) : between(r, 3, 4),
        amenities,
        pets: pick(r, PETS),
        description: template(place.hood, pick(r, LANDMARKS)),
        plans: building ? buildingPlans(r, place.hood) : [homePlan(r, place)],
    };
}

/** Every listing, in PLACES order. One stream, consumed in order, so a row added at the end leaves the others as they were. */
export function generateAll(): SeedListing[] {
    const r = prng(20261015);
    return PLACES.map((place, index) => generate(place, index, r));
}

export { NEIGHBORHOODS };
