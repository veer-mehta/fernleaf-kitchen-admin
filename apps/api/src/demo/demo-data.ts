// The demo catalogue and companies, as plain data. Money is in cents (paise).
// Nothing here is a date: orders are generated relative to "today" in demo-orders.ts.

export const ALLERGENS = ["Gluten", "Dairy", "Nuts", "Soy", "Egg"];
export const DIETARY_TAGS = ["Vegetarian", "Vegan", "Jain", "Gluten-free"];
export const STATIONS = ["Hot Line", "Tandoor", "Cold Kitchen", "Dessert Counter", "Beverage Bar"];
export const PORTION_SIZES = ["Regular", "Large"];

export interface OptionDef { key: string; name: string; costCents: number; allergens?: string[]; tags?: string[]; sizes?: string[] }
export const OPTIONS: OptionDef[] = [
  { key: "paneer", name: "Paneer", costCents: 2200, allergens: ["Dairy"], tags: ["Vegetarian"], sizes: ["Regular", "Large"] },
  { key: "tofu", name: "Tofu", costCents: 1800, allergens: ["Soy"], tags: ["Vegan"], sizes: ["Regular", "Large"] },
  { key: "chickpeas", name: "Chickpeas", costCents: 1200, tags: ["Vegan", "Gluten-free"], sizes: ["Regular", "Large"] },
  { key: "brownRice", name: "Brown rice", costCents: 800, tags: ["Vegan", "Gluten-free"] },
  { key: "jeeraRice", name: "Jeera rice", costCents: 700, tags: ["Vegan", "Gluten-free"] },
  { key: "steamedRice", name: "Steamed rice", costCents: 500, tags: ["Vegan", "Gluten-free", "Jain"] },
  { key: "roti", name: "Whole wheat roti", costCents: 500, allergens: ["Gluten"], tags: ["Vegan"] },
  { key: "naan", name: "Plain naan", costCents: 600, allergens: ["Gluten"], tags: ["Vegetarian"] },
  { key: "butterNaan", name: "Butter naan", costCents: 800, allergens: ["Gluten", "Dairy"], tags: ["Vegetarian"] },
  { key: "raita", name: "Raita", costCents: 600, allergens: ["Dairy"], tags: ["Vegetarian"] },
  { key: "mintChutney", name: "Mint chutney", costCents: 300, tags: ["Vegan", "Gluten-free"] },
  { key: "pickle", name: "Pickle", costCents: 200, tags: ["Vegan", "Gluten-free"] },
  { key: "salad", name: "Fresh salad", costCents: 500, tags: ["Vegan", "Gluten-free", "Jain"] },
  { key: "coconutChutney", name: "Coconut chutney", costCents: 400, tags: ["Vegan", "Gluten-free"] },
  { key: "sambar", name: "Extra sambar", costCents: 400, tags: ["Vegan", "Gluten-free"] },
];

// The choice groups a dish can offer. Each is required (exactly one) or optional (zero or one).
// "portions" = the group sells its options in sizes, each with an extra charge (cents) on top of the option's price.
export const GROUPS: Record<string, { name: string; required: boolean; options: string[]; portions?: { size: string; extraCents: number }[] }> = {
  protein: { name: "Choose your protein", required: true, options: ["paneer", "tofu", "chickpeas"], portions: [{ size: "Regular", extraCents: 0 }, { size: "Large", extraCents: 4000 }] },
  rice: { name: "Choose your rice", required: true, options: ["brownRice", "jeeraRice", "steamedRice"] },
  bread: { name: "Choose your bread", required: true, options: ["roti", "naan", "butterNaan"] },
  sides: { name: "Add a side", required: false, options: ["raita", "mintChutney", "pickle"] },
  thaliSide: { name: "Add a side", required: false, options: ["raita", "salad"] },
  chutney: { name: "Extra chutney", required: false, options: ["coconutChutney", "sambar", "mintChutney"] },
};

export interface DishDef {
  sku: string; name: string; description: string; temperature: "HOT" | "COLD"; costCents: number; station: string;
  minOrderQty?: number; allergens?: string[]; tags?: string[]; groups?: string[]; category: string;
}
export const DISHES: DishDef[] = [
  // Bowls & Combos
  { sku: "BWL-01", name: "Protein Power Bowl", description: "Rice, a protein of your choice, seasonal vegetables and house tadka", temperature: "HOT", costCents: 8500, station: "Hot Line", minOrderQty: 5, allergens: [], tags: ["Vegetarian"], groups: ["protein", "rice", "sides"], category: "Bowls & Combos" },
  { sku: "BWL-02", name: "Rajma Chawal Bowl", description: "Slow-cooked kidney beans over rice", temperature: "HOT", costCents: 7000, station: "Hot Line", tags: ["Vegetarian"], groups: ["rice", "sides"], category: "Bowls & Combos" },
  { sku: "BWL-03", name: "Dal Makhani Rice Bowl", description: "Creamy black lentils with rice", temperature: "HOT", costCents: 7800, station: "Hot Line", allergens: ["Dairy"], tags: ["Vegetarian"], groups: ["rice", "sides"], category: "Bowls & Combos" },
  { sku: "BWL-04", name: "Chole Rice Bowl", description: "Spiced chickpea curry with rice", temperature: "HOT", costCents: 7200, station: "Hot Line", tags: ["Vegan"], groups: ["rice", "sides"], category: "Bowls & Combos" },
  { sku: "BWL-05", name: "Veg Biryani Bowl", description: "Fragrant basmati layered with vegetables", temperature: "HOT", costCents: 8200, station: "Hot Line", allergens: ["Dairy"], tags: ["Vegetarian"], groups: ["sides"], category: "Bowls & Combos" },
  { sku: "BWL-06", name: "Millet Khichdi Bowl", description: "Comforting millet and lentil khichdi", temperature: "HOT", costCents: 6500, station: "Hot Line", tags: ["Vegan", "Gluten-free", "Jain"], groups: ["sides"], category: "Bowls & Combos" },
  { sku: "BWL-07", name: "Hummus Power Bowl", description: "Cold bowl with hummus, quinoa and grilled vegetables", temperature: "COLD", costCents: 8000, station: "Cold Kitchen", allergens: [], tags: ["Vegan"], groups: ["protein"], category: "Bowls & Combos" },
  // Thalis
  { sku: "THL-01", name: "North Indian Thali", description: "Dal, sabzi, rice, bread, salad and a sweet", temperature: "HOT", costCents: 10500, station: "Hot Line", allergens: ["Gluten", "Dairy"], tags: ["Vegetarian"], groups: ["bread", "thaliSide"], category: "Thalis" },
  { sku: "THL-02", name: "Palak Paneer Thali", description: "Spinach and paneer with dal, rice and bread", temperature: "HOT", costCents: 10000, station: "Hot Line", allergens: ["Gluten", "Dairy"], tags: ["Vegetarian"], groups: ["bread", "thaliSide"], category: "Thalis" },
  { sku: "THL-03", name: "Paneer Butter Masala Thali", description: "Rich tomato-cashew gravy with paneer", temperature: "HOT", costCents: 11000, station: "Tandoor", allergens: ["Gluten", "Dairy", "Nuts"], tags: ["Vegetarian"], groups: ["bread", "thaliSide"], category: "Thalis" },
  { sku: "THL-04", name: "Jain Thali", description: "No onion, no garlic, no root vegetables", temperature: "HOT", costCents: 9800, station: "Hot Line", allergens: ["Gluten"], tags: ["Vegetarian", "Jain"], groups: ["bread"], category: "Thalis" },
  { sku: "THL-05", name: "Mini Meal Combo", description: "Half thali for lighter appetites", temperature: "HOT", costCents: 8800, station: "Hot Line", allergens: ["Gluten"], tags: ["Vegetarian"], groups: ["bread"], category: "Thalis" },
  // Breakfast
  { sku: "BRK-01", name: "Idli Sambar", description: "Three steamed idlis with sambar", temperature: "HOT", costCents: 3500, station: "Hot Line", tags: ["Vegan", "Gluten-free"], groups: ["chutney"], category: "Breakfast" },
  { sku: "BRK-02", name: "Masala Dosa", description: "Crisp dosa with potato masala", temperature: "HOT", costCents: 4500, station: "Hot Line", tags: ["Vegan", "Gluten-free"], groups: ["chutney"], category: "Breakfast" },
  { sku: "BRK-03", name: "Vegetable Poha", description: "Flattened rice with peanuts and lemon", temperature: "HOT", costCents: 3000, station: "Hot Line", allergens: ["Nuts"], tags: ["Vegan", "Jain"], category: "Breakfast" },
  { sku: "BRK-04", name: "Rava Upma", description: "Semolina upma with vegetables", temperature: "HOT", costCents: 3000, station: "Hot Line", allergens: ["Gluten"], tags: ["Vegan"], category: "Breakfast" },
  { sku: "BRK-05", name: "Aloo Paratha", description: "Stuffed paratha served with curd", temperature: "HOT", costCents: 4000, station: "Tandoor", allergens: ["Gluten", "Dairy"], tags: ["Vegetarian"], groups: ["sides"], category: "Breakfast" },
  // Snacks & Wraps
  { sku: "SNK-01", name: "Veg Club Sandwich", description: "Toasted triple-decker with fresh vegetables", temperature: "COLD", costCents: 4500, station: "Cold Kitchen", allergens: ["Gluten", "Dairy"], tags: ["Vegetarian"], category: "Snacks & Wraps" },
  { sku: "SNK-02", name: "Paneer Tikka Wrap", description: "Tandoori paneer in a whole wheat wrap", temperature: "HOT", costCents: 5500, station: "Tandoor", allergens: ["Gluten", "Dairy"], tags: ["Vegetarian"], category: "Snacks & Wraps" },
  { sku: "SNK-03", name: "Sprout Salad Box", description: "Sprouts, cucumber, tomato and lemon dressing", temperature: "COLD", costCents: 4200, station: "Cold Kitchen", tags: ["Vegan", "Gluten-free"], category: "Snacks & Wraps" },
  { sku: "SNK-04", name: "Samosa Chaat", description: "Crushed samosa with chutneys and yoghurt", temperature: "HOT", costCents: 3800, station: "Hot Line", allergens: ["Gluten", "Dairy"], tags: ["Vegetarian"], category: "Snacks & Wraps" },
  // Desserts
  { sku: "DES-01", name: "Gulab Jamun (2 pc)", description: "Warm milk dumplings in cardamom syrup", temperature: "HOT", costCents: 2800, station: "Dessert Counter", allergens: ["Dairy", "Gluten"], tags: ["Vegetarian"], category: "Desserts" },
  { sku: "DES-02", name: "Seasonal Fruit Bowl", description: "Cut fresh fruit", temperature: "COLD", costCents: 2500, station: "Dessert Counter", tags: ["Vegan", "Gluten-free"], category: "Desserts" },
  { sku: "DES-03", name: "Chocolate Brownie", description: "Fudgy walnut brownie", temperature: "COLD", costCents: 3200, station: "Dessert Counter", allergens: ["Gluten", "Egg", "Dairy", "Nuts"], tags: ["Vegetarian"], category: "Desserts" },
  { sku: "DES-04", name: "Rasmalai", description: "Soft cheese dumplings in saffron milk", temperature: "COLD", costCents: 4000, station: "Dessert Counter", allergens: ["Dairy", "Nuts"], tags: ["Vegetarian"], category: "Desserts" },
  // Beverages
  { sku: "BEV-01", name: "Masala Chai", description: "Ginger and cardamom tea", temperature: "HOT", costCents: 1200, station: "Beverage Bar", allergens: ["Dairy"], tags: ["Vegetarian"], category: "Beverages" },
  { sku: "BEV-02", name: "Sweet Lassi", description: "Chilled yoghurt drink", temperature: "COLD", costCents: 2000, station: "Beverage Bar", allergens: ["Dairy"], tags: ["Vegetarian"], category: "Beverages" },
  { sku: "BEV-03", name: "Cold Coffee", description: "Iced coffee with milk", temperature: "COLD", costCents: 2400, station: "Beverage Bar", allergens: ["Dairy"], tags: ["Vegetarian"], category: "Beverages" },
  { sku: "BEV-04", name: "Fresh Lime Soda", description: "Sweet or salted", temperature: "COLD", costCents: 1500, station: "Beverage Bar", tags: ["Vegan", "Gluten-free"], category: "Beverages" },
  // Chef's specials: a secret category, not listed to employees
  { sku: "CHF-01", name: "Truffle Mushroom Risotto", description: "Arborio rice, wild mushrooms, truffle oil", temperature: "HOT", costCents: 14000, station: "Hot Line", allergens: ["Dairy"], tags: ["Vegetarian"], category: "Chef's Specials" },
  { sku: "CHF-02", name: "Smoked Paneer Steak", description: "Charcoal-smoked paneer with grilled vegetables", temperature: "HOT", costCents: 13000, station: "Tandoor", allergens: ["Dairy"], tags: ["Vegetarian"], category: "Chef's Specials" },
];

export const CATEGORIES: { name: string; secret?: boolean }[] = [
  { name: "Bowls & Combos" }, { name: "Thalis" }, { name: "Breakfast" }, { name: "Snacks & Wraps" },
  { name: "Desserts" }, { name: "Beverages" }, { name: "Chef's Specials", secret: true },
];

// Three price tiers. Standard is cost x 2.5; Enterprise is Standard less 10%; Partner is typed in by hand
// (85% of Standard) and does not sell Rasmalai at all, so that dish is hidden from Partner companies.
export const TIERS = {
  standard: { name: "Standard", multiplierMilli: 2500 },
  enterprise: { name: "Enterprise", percentBp: -1000 },
  partner: { name: "Partner", factorPercent: 85, skipSkus: ["DES-04"] },
};
// A few typed-in prices that win over the derived ones (cents, on the named tier).
export const PRICE_OVERRIDES: { tier: "standard" | "enterprise"; sku: string; cents: number }[] = [
  { tier: "standard", sku: "BEV-03", cents: 6000 },
  { tier: "enterprise", sku: "BWL-01", cents: 19000 },
];

export interface CompanyDef {
  name: string; domain: string; tier: "standard" | "enterprise" | "partner"; workingDays: number[]; deliveryTime: string; deliveryMinutes: number;
  packaging: "STANDARD" | "ECO" | "INSULATED"; instructions: string; defaultDriver: boolean;
  billing: { name: string; email: string; phone: string };
  addresses: { label: string; line1: string; city: string; postalCode: string; instructions?: string }[];
  hiddenCategories?: string[]; hiddenDishes?: string[];
  // company holiday as a day offset from today (so it always lies ahead of the review day)
  holidayInDays?: number;
  ordersPerDay: number;
  employees: { name: string; canChooseAddress?: boolean; canChangeTime?: boolean; canChangePackaging?: boolean; allergens?: string[]; tags?: string[] }[];
}

export const COMPANIES: CompanyDef[] = [
  {
    name: "Acme Technologies", domain: "acme.in", tier: "standard", workingDays: [1, 2, 3, 4, 5], deliveryTime: "13:00", deliveryMinutes: 60, packaging: "STANDARD",
    instructions: "Deliver to reception on the ground floor and ask for the facilities desk.", defaultDriver: true,
    billing: { name: "Meera Kulkarni", email: "accounts@acme.in", phone: "+91 20 5550 0101" },
    addresses: [{ label: "Pune HQ", line1: "Tower B, Hinjewadi Phase 2", city: "Pune", postalCode: "411057", instructions: "Gate 2" }, { label: "Pune Labs", line1: "Baner Road, Plot 14", city: "Pune", postalCode: "411045" }],
    holidayInDays: 10, ordersPerDay: 3,
    employees: [
      { name: "Aarav Sharma", canChooseAddress: true, canChangeTime: true }, { name: "Diya Patel", allergens: ["Nuts"] }, { name: "Kabir Singh", tags: ["Vegan"] },
      { name: "Ishita Rao" }, { name: "Rohan Desai", canChangePackaging: true }, { name: "Ananya Iyer", tags: ["Jain"] }, { name: "Vihaan Joshi" }, { name: "Saanvi Nair", allergens: ["Dairy"] },
    ],
  },
  {
    name: "Globex Pharma", domain: "globex.co.in", tier: "enterprise", workingDays: [1, 2, 3, 4, 5], deliveryTime: "12:30", deliveryMinutes: 45, packaging: "INSULATED",
    instructions: "Sign in at security. Cafeteria is on level 3.", defaultDriver: false,
    billing: { name: "Rahul Menon", email: "payables@globex.co.in", phone: "+91 22 5550 0202" },
    addresses: [{ label: "Mumbai Campus", line1: "Powai Business Park", city: "Mumbai", postalCode: "400076" }],
    hiddenCategories: ["Desserts"], holidayInDays: 12, ordersPerDay: 2,
    employees: [
      { name: "Priya Banerjee", canChangeTime: true }, { name: "Arjun Kapoor" }, { name: "Neha Gupta", tags: ["Vegetarian"] }, { name: "Siddharth Rao", allergens: ["Gluten"] },
      { name: "Tanvi Shah" }, { name: "Manav Verma", canChooseAddress: true }, { name: "Riya Malhotra" },
    ],
  },
  {
    name: "Initech Consulting", domain: "initech.co.in", tier: "partner", workingDays: [7, 1, 2, 3, 4], deliveryTime: "13:30", deliveryMinutes: 75, packaging: "ECO",
    instructions: "Call the front desk on arrival.", defaultDriver: false,
    billing: { name: "Farhan Qureshi", email: "finance@initech.co.in", phone: "+91 80 5550 0303" },
    addresses: [{ label: "Bengaluru Office", line1: "Embassy Tech Village, Block 4", city: "Bengaluru", postalCode: "560103" }, { label: "Whitefield Annex", line1: "ITPL Main Road", city: "Bengaluru", postalCode: "560066" }],
    hiddenDishes: ["BWL-04"], ordersPerDay: 2,
    employees: [
      { name: "Zoya Khan", canChooseAddress: true, canChangeTime: true, canChangePackaging: true }, { name: "Karthik Reddy" }, { name: "Lakshmi Pillai", tags: ["Vegan"] },
      { name: "Imran Sheikh" }, { name: "Pooja Hegde" }, { name: "Nikhil Bhat", allergens: ["Soy"] },
    ],
  },
  {
    name: "Umbrella Logistics", domain: "umbrellalogistics.in", tier: "standard", workingDays: [1, 2, 3, 4, 5, 6, 7], deliveryTime: "12:00", deliveryMinutes: 60, packaging: "STANDARD",
    instructions: "Warehouse canteen, use the loading-bay entrance.", defaultDriver: true,
    billing: { name: "Harpreet Gill", email: "billing@umbrellalogistics.in", phone: "+91 124 5550 0404" },
    addresses: [{ label: "Gurugram Warehouse", line1: "Sector 37, Industrial Area", city: "Gurugram", postalCode: "122001", instructions: "Loading bay B" }],
    hiddenDishes: ["BEV-03"], ordersPerDay: 3,
    employees: [
      { name: "Sandeep Yadav", canChangeTime: true }, { name: "Gurpreet Kaur", canChangeTime: true }, { name: "Mohit Chauhan", canChangeTime: true }, { name: "Anita Thakur", tags: ["Vegetarian"] },
      { name: "Deepak Mishra", canChangeTime: true }, { name: "Rekha Pandey", allergens: ["Dairy"] }, { name: "Vikram Rathore" }, { name: "Sunita Devi" },
    ],
  },
  {
    name: "Wayne Finance", domain: "waynefinance.com", tier: "enterprise", workingDays: [1, 2, 3, 4, 5, 6], deliveryTime: "13:15", deliveryMinutes: 60, packaging: "ECO",
    instructions: "Executive floor: deliver to the pantry on level 12.", defaultDriver: true,
    billing: { name: "Ira Kapadia", email: "ap@waynefinance.com", phone: "+91 22 5550 0505" },
    addresses: [{ label: "BKC Head Office", line1: "G Block, Bandra Kurla Complex", city: "Mumbai", postalCode: "400051" }],
    holidayInDays: 9, ordersPerDay: 2,
    employees: [
      { name: "Aditya Mehra", canChangeTime: true, canChangePackaging: true }, { name: "Kavya Subramanian" }, { name: "Rajat Bhargava", tags: ["Jain"] },
      { name: "Shreya Dutta" }, { name: "Yash Agarwal" }, { name: "Mitali Sen", allergens: ["Egg"] }, { name: "Dev Oberoi" },
    ],
  },
];
