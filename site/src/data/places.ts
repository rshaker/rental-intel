/**
 * The listings of the example site, by identity: what a screenshot shows.
 * Every name, street and number is invented in the style of Austin, TX;
 * none is a real building, address or business. The numbers that fill
 * each one in (plans, rents, dates) come from generate.ts.
 *
 * Order matters: the store artwork captures the first nine, so the first
 * is a building with several plans and the nine alternate kinds.
 */

export const NEIGHBORHOODS = [
    "Hyde Park",
    "Mueller",
    "East Austin",
    "South Lamar",
    "Zilker",
    "North Loop",
    "Crestview",
    "Clarksville",
    "Riverside",
    "West Campus",
    "Rosedale",
    "Bouldin Creek",
    "Allandale",
    "Brentwood",
] as const;

export type Neighborhood = (typeof NEIGHBORHOODS)[number];

export interface Place {
    /** The listing id in the URL: /l/<id>/. Lowercase alphanumerics, 4 to 12 characters. */
    id: string;
    kind: "building" | "home";
    type: "apartment" | "house" | "condo" | "townhome";
    /** A building's name; a home's is its address line. */
    name: string;
    street: string;
    unit?: string;
    hood: Neighborhood;
    zip: string;
}

const B = "building" as const;
const H = "home" as const;

export const PLACES: readonly Place[] = [
    // The nine the store artwork captures, in order.
    { id: "arbor1800", kind: B, type: "apartment", name: "The Arbor", street: "1800 Lavaca St", hood: "West Campus", zip: "78701" },
    { id: "riogr2210", kind: H, type: "condo", name: "2210 Rio Grande St #4", street: "2210 Rio Grande St", unit: "4", hood: "West Campus", zip: "78705" },
    { id: "pecan4100", kind: B, type: "apartment", name: "Pecan Flats", street: "4100 Duval St", hood: "Hyde Park", zip: "78751" },
    { id: "e38th905", kind: H, type: "house", name: "905 E 38th St", street: "905 E 38th St", hood: "Hyde Park", zip: "78705" },
    { id: "cedar3200", kind: B, type: "apartment", name: "Cedar Court", street: "3200 Guadalupe St", hood: "Hyde Park", zip: "78705" },
    { id: "kinney1507", kind: H, type: "townhome", name: "1507 Kinney Ave", street: "1507 Kinney Ave", hood: "South Lamar", zip: "78704" },
    { id: "loopline", kind: B, type: "apartment", name: "Loop Line Lofts", street: "5310 N Lamar Blvd", hood: "North Loop", zip: "78751" },
    { id: "grooms3104", kind: H, type: "house", name: "3104 Grooms St Unit B", street: "3104 Grooms St", unit: "B", hood: "West Campus", zip: "78705" },
    { id: "redbud", kind: B, type: "apartment", name: "Redbud Commons", street: "2100 Simond Ave", hood: "Mueller", zip: "78723" },
    // The rest of the city.
    { id: "shoal1200", kind: B, type: "apartment", name: "Shoal Creek Terrace", street: "1200 W 9th St", hood: "Clarksville", zip: "78703" },
    { id: "mock2701", kind: B, type: "apartment", name: "Mockingbird Flats", street: "2701 Burleson Rd", hood: "Riverside", zip: "78741" },
    { id: "bluebon", kind: B, type: "apartment", name: "Bluebonnet Row", street: "1911 S 1st St", hood: "Bouldin Creek", zip: "78704" },
    { id: "cypress6", kind: B, type: "apartment", name: "Cypress Six", street: "600 E 6th St", hood: "East Austin", zip: "78702" },
    { id: "willow7400", kind: B, type: "apartment", name: "Willow Bend Apartments", street: "7400 Burnet Rd", hood: "Crestview", zip: "78757" },
    { id: "ramsey4500", kind: B, type: "apartment", name: "The Ramsey", street: "4500 Avenue D", hood: "Hyde Park", zip: "78751" },
    { id: "bartonv", kind: B, type: "apartment", name: "Barton View", street: "1510 Barton Springs Rd", hood: "Zilker", zip: "78704" },
    { id: "koenig2200", kind: B, type: "apartment", name: "Koenig Lane Flats", street: "2200 W Koenig Ln", hood: "Allandale", zip: "78756" },
    { id: "northcross", kind: B, type: "apartment", name: "Northcross Commons", street: "7800 Shoal Creek Blvd", hood: "Brentwood", zip: "78757" },
    { id: "manor1800", kind: B, type: "apartment", name: "Manor Road Lofts", street: "1800 Manor Rd", hood: "East Austin", zip: "78722" },
    { id: "sunset4205", kind: B, type: "apartment", name: "Sunset Lane Apartments", street: "4205 Sunset Trl", hood: "Rosedale", zip: "78756" },
    { id: "lamar2400", kind: B, type: "apartment", name: "The Lamar", street: "2400 S Lamar Blvd", hood: "South Lamar", zip: "78704" },
    { id: "tillery", kind: B, type: "apartment", name: "Tillery Street Lofts", street: "1100 Tillery St", hood: "East Austin", zip: "78702" },
    { id: "airport5500", kind: B, type: "apartment", name: "Airport Boulevard Commons", street: "5500 Airport Blvd", hood: "North Loop", zip: "78751" },
    { id: "ave4107", kind: H, type: "house", name: "4107 Avenue H", street: "4107 Avenue H", hood: "Hyde Park", zip: "78751" },
    { id: "oltorf1400", kind: H, type: "condo", name: "1400 E Oltorf St #212", street: "1400 E Oltorf St", unit: "212", hood: "Riverside", zip: "78741" },
    { id: "enfield2308", kind: H, type: "condo", name: "2308 Enfield Rd #108", street: "2308 Enfield Rd", unit: "108", hood: "Clarksville", zip: "78703" },
    { id: "wilsh1206", kind: H, type: "house", name: "1206 Wilshire Blvd", street: "1206 Wilshire Blvd", hood: "Mueller", zip: "78722" },
    { id: "bouldin904", kind: H, type: "townhome", name: "904 Bouldin Ave", street: "904 Bouldin Ave", hood: "Bouldin Creek", zip: "78704" },
    { id: "holly1600", kind: H, type: "house", name: "1600 Holly St", street: "1600 Holly St", hood: "East Austin", zip: "78702" },
    { id: "woodrow5204", kind: H, type: "house", name: "5204 Woodrow Ave", street: "5204 Woodrow Ave", hood: "Brentwood", zip: "78756" },
    { id: "arroyo3300", kind: H, type: "townhome", name: "3300 Arroyo Seco #2", street: "3300 Arroyo Seco", unit: "2", hood: "Allandale", zip: "78757" },
    { id: "elmont2200", kind: H, type: "condo", name: "2200 Elmont Dr #4B", street: "2200 Elmont Dr", unit: "4B", hood: "Riverside", zip: "78741" },
];
