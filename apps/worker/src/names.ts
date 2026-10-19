/**
 * Display names handed to new visitors: well-known Marvel characters. Each
 * board gives every member a different one (see BoardStorage.joinMember).
 * Marvel names are Disney trademarks; this list is easy to swap if needed.
 */
export const MARVEL_NAMES = [
  "Iron Man", "Captain America", "Thor", "Hulk", "Black Widow", "Hawkeye", "Spider-Man", "Black Panther",
  "Doctor Strange", "Scarlet Witch", "Vision", "Ant-Man", "Wasp", "Captain Marvel", "Falcon", "Winter Soldier",
  "War Machine", "Star-Lord", "Gamora", "Drax", "Rocket", "Groot", "Mantis", "Nebula", "Yondu", "Wolverine",
  "Storm", "Cyclops", "Jean Grey", "Rogue", "Gambit", "Beast", "Iceman", "Nightcrawler", "Colossus", "Kitty Pryde",
  "Jubilee", "Psylocke", "Bishop", "Cable", "Deadpool", "Domino", "Magneto", "Mystique", "Professor X", "Emma Frost",
  "Havok", "Polaris", "Archangel", "Banshee", "Sunfire", "Forge", "Dazzler", "Longshot", "Multiple Man", "Sabretooth",
  "Juggernaut", "Apocalypse", "Mister Sinister", "Daredevil", "Elektra", "Punisher", "Luke Cage", "Iron Fist",
  "Jessica Jones", "Moon Knight", "Blade", "Ghost Rider", "She-Hulk", "Ms. Marvel", "Squirrel Girl", "Silver Surfer",
  "Nova", "Quasar", "Adam Warlock", "Shang-Chi", "Echo", "Kate Bishop", "America Chavez", "Miles Morales",
  "Spider-Gwen", "Spider-Woman", "Silk", "Venom", "Carnage", "Black Cat", "Mysterio", "Vulture", "Rhino", "Sandman",
  "Electro", "Kraven", "Lizard", "Scorpion", "Shocker", "Green Goblin", "Hobgoblin", "Doctor Octopus", "Kingpin",
  "Bullseye", "Loki", "Thanos", "Ultron", "Red Skull", "Doctor Doom", "Galactus", "Kang", "Hela", "Mephisto",
  "Dormammu", "Annihilus", "Mister Fantastic", "Invisible Woman", "Human Torch", "The Thing", "Franklin Richards",
  "Namor", "Black Bolt", "Medusa", "Crystal", "Karnak", "Gorgon", "Lockjaw", "Quicksilver", "Wonder Man", "Tigra",
  "Hercules", "Sersi", "Ikaris", "Thena", "Makkari", "Sprite", "Kingo", "Druig", "Phastos", "Ajak", "Valkyrie", "Sif",
  "Heimdall", "Odin", "Frigga", "Beta Ray Bill", "Jane Foster", "Nick Fury", "Maria Hill", "Phil Coulson",
  "Peggy Carter", "Mockingbird", "Quake", "Cloak", "Dagger", "Wiccan", "Hulkling", "Speed", "Patriot", "Stature",
  "Ironheart", "Moon Girl", "Devil Dinosaur", "Ghost-Spider", "Spider-Ham", "Howard the Duck", "Man-Thing",
  "Werewolf by Night", "Elsa Bloodstone", "Hellcat", "Photon", "Spectrum", "Captain Britain", "Union Jack",
  "Shatterstar", "Warpath", "Moonstar", "Sunspot", "Magik", "Wolfsbane", "Cannonball", "Karma", "Cypher", "Warlock",
  "X-23", "Daken", "Omega Red", "Silver Samurai", "Lady Deathstrike", "Morbius", "Nightmare", "Clea", "Wong",
  "Baron Mordo", "Ancient One", "Brother Voodoo", "Taskmaster", "Crossbones", "Batroc", "Baron Zemo", "Abomination",
  "The Leader", "Absorbing Man", "Titania", "Wrecker", "Graviton", "Klaw", "Killmonger", "Shuri", "Okoye", "Nakia",
  "M'Baku", "Ramonda", "Sentry", "Blue Marvel", "Hyperion", "Nighthawk", "Gladiator", "Silver Sable", "Prowler",
  "Puma", "Tombstone", "Hammerhead", "Mister Negative", "Morlun", "Jackal", "Scarlet Spider", "Kaine", "Firestar",
  "Cosmo", "Moondragon", "Starfox", "Ronan", "Korath", "Corvus Glaive", "Proxima Midnight", "Ebony Maw",
  "Cull Obsidian", "Nova Prime", "Captain Universe", "Black Knight", "Swordsman", "Blue Shield",
  "Darkhawk", "Sleepwalker", "Deathlok", "Nomad", "U.S. Agent", "Red Guardian", "Yelena Belova", "Ghost", "Arcade",
  "Toad", "Blob", "Pyro", "Avalanche", "Destiny", "Mastermind", "Sauron", "Selene", "Exodus", "Onslaught",
  "Bastion", "Mister Hyde", "Whirlwind", "Living Laser", "Grim Reaper", "Enchantress", "Executioner", "Amora",
  "Molecule Man", "Owl", "Hood", "Madame Masque", "Count Nefaria", "Arnim Zola", "Viper", "Madame Hydra", "Ultimo",
  "Fin Fang Foom", "Sphinx", "Super-Skrull", "Collector", "Grandmaster", "Ego", "Eternity", "Living Tribunal",
  "Uatu", "Death", "Lady Sif", "Volstagg", "Fandral", "Hogun", "Balder", "Surtur", "Ymir", "Malekith", "Kurse",
  "Squadron", "Doctor Spectrum", "Speedball", "Justice", "Rage", "Night Thrasher", "Namorita", "Firelord",
  "Terrax", "Air-Walker", "Morg", "Stardust", "Frankie Raye", "Captain Mar-Vell", "Genis-Vell", "Phyla-Vell",
  "Rick Jones", "Bucky Barnes", "Sharon Carter", "Sam Wilson", "Rhodey", "Pepper Potts", "Happy Hogan",
  "Aunt May", "Mary Jane", "Gwen Stacy", "J. Jonah Jameson", "Betty Brant", "Flash Thompson", "Harry Osborn",
  "Felicia Hardy", "Dr. Connors", "Wanda", "Pietro", "Lorna Dane", "Scott Summers", "Logan", "Ororo Munroe",
  "Hank McCoy", "Bobby Drake", "Kurt Wagner", "Piotr Rasputin", "Remy LeBeau", "Anna Marie", "Betsy Braddock",
  "Lucas Bishop", "Nathan Summers", "Wade Wilson", "Erik Lehnsherr", "Raven Darkholme", "Charles Xavier",
  "Matt Murdock", "Frank Castle", "Danny Rand", "Marc Spector", "Eric Brooks", "Johnny Blaze", "Robbie Reyes",
  "Jennifer Walters", "Kamala Khan", "Doreen Green", "Norrin Radd", "Richard Rider", "Wendell Vaughn",
  "Maya Lopez", "Riri Williams", "Lunella Lafayette", "Cindy Moon", "Jessica Drew", "Eddie Brock", "Cletus Kasady",
] as const;

/**
 * A name nobody in `taken` has (compared case-insensitively). Picks at
 * random so boards don't all start with Iron Man; once every name is in use,
 * adds a number ("Storm 2").
 */
export function pickName(taken: Set<string>, random: () => number = Math.random): string {
  const free = MARVEL_NAMES.filter((n) => !taken.has(n.toLowerCase()));
  if (free.length) return free[Math.floor(random() * free.length)];
  for (let i = 2; ; i++) {
    const base = MARVEL_NAMES[Math.floor(random() * MARVEL_NAMES.length)];
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
