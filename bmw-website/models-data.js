/**
 * BMW Showcase & Interactive Experience - Models Dataset
 * Authentic specifications, configurations, paint palettes, and wheel designs
 * for BMW flagship vehicles.
 */

(function (global) {
  'use strict';

  const CATEGORIES = [
    { id: 'all', label: 'All Models', description: 'Explore the full luxury and performance range' },
    { id: 'm-power', label: 'BMW M Power', description: 'Track-bred high performance and raw emotion' },
    { id: 'bmw-i', label: 'BMW i Electric', description: 'Visionary all-electric luxury and zero emissions' },
    { id: 'bmw-x', label: 'BMW X SAVs', description: 'Sports Activity Vehicles engineered for any terrain' },
    { id: 'luxury', label: 'Luxury Sedans', description: 'Executive sophistication, comfort, and forwardism' }
  ];

  const MODELS_DATA = [
    {
      id: 'm3-competition',
      name: 'BMW M3 Competition Sedan',
      series: 'M3 Series',
      bodyType: 'Sedan',
      tagline: 'Defying Physics. Amplifying Adrenaline.',
      badge: 'M Competition',
      badgeColor: '#e2001a',
      categories: ['all', 'm-power', 'luxury'],
      basePrice: 85300,
      priceFormatted: '$85,300',
      specs: {
        horsepower: 523,
        horsepowerDisplay: '523 hp',
        torque: '479 lb-ft @ 2,750-5,730 rpm',
        acceleration: 3.4,
        accelerationDisplay: '3.4s (0-60 mph)',
        topSpeed: '180 mph',
        powertrain: '3.0L M TwinPower Turbo inline 6-cylinder',
        transmission: '8-speed M Steptronic with Drivelogic',
        drivetrain: 'M xDrive Intelligent All-Wheel Drive',
        fuelEconomy: '16 / 22 mpg',
        curbWeight: '3,990 lbs',
        electricRange: 'N/A (Combustion)',
        batteryCapacity: 'N/A'
      },
      dimensions: {
        length: '189.1 in',
        width: '74.3 in',
        height: '56.4 in',
        wheelbase: '112.5 in'
      },
      keyFeatures: [
        'M Carbon Ceramic Brakes compatibility',
        'BMW Curved Display with M-specific graphics (OS 8.5)',
        'M Carbon Bucket Seats available',
        'Adaptive M Suspension with active M Differential',
        'M Drive and M Traction Control (10 stages)'
      ],
      colors: [
        {
          id: 'isle-of-man-green',
          name: 'Isle of Man Green metallic',
          hex: '#184738',
          secondaryHex: '#256d56',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'sao-paulo-yellow',
          name: 'Sao Paulo Yellow',
          hex: '#d6ea28',
          secondaryHex: '#f1ff52',
          finish: 'Non-metallic',
          priceDelta: 0
        },
        {
          id: 'toronto-red',
          name: 'Toronto Red metallic',
          hex: '#b31b25',
          secondaryHex: '#de2834',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'tanzanite-blue',
          name: 'Tanzanite Blue II metallic',
          hex: '#10254c',
          secondaryHex: '#1e3d78',
          finish: 'BMW Individual',
          priceDelta: 1500
        },
        {
          id: 'dravit-grey',
          name: 'Dravit Grey metallic',
          hex: '#3f4145',
          secondaryHex: '#5e6167',
          finish: 'BMW Individual',
          priceDelta: 1500
        },
        {
          id: 'frozen-pure-grey',
          name: 'Frozen Pure Grey II metallic',
          hex: '#696e75',
          secondaryHex: '#888f98',
          finish: 'Frozen Matte',
          priceDelta: 3600
        },
        {
          id: 'black-sapphire',
          name: 'Black Sapphire metallic',
          hex: '#111317',
          secondaryHex: '#22252c',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'alpine-white',
          name: 'Alpine White',
          hex: '#f5f6f8',
          secondaryHex: '#ffffff',
          finish: 'Non-metallic',
          priceDelta: 0
        }
      ],
      wheels: [
        {
          id: 'style-826m-black',
          name: '19"/20" M Double-spoke Style 826 M Black',
          size: 'Front: 19x9.5 | Rear: 20x10.5',
          finish: 'Jet Black with M Emblem',
          priceDelta: 0
        },
        {
          id: 'style-825m-orbit-grey',
          name: '19"/20" M Double-spoke Style 825 M Bicolor',
          size: 'Front: 19x9.5 | Rear: 20x10.5',
          finish: 'Orbit Grey Burnished',
          priceDelta: 1300
        },
        {
          id: 'style-826m-bronze',
          name: '19"/20" M Performance Style 826 M Frozen Gold Bronze',
          size: 'Front: 19x9.5 | Rear: 20x10.5',
          finish: 'M Performance Gold Bronze',
          priceDelta: 2400
        }
      ],
      interiors: [
        {
          id: 'yas-marina',
          name: 'Yas Marina Blue / Black Extended Merino Leather with Yellow accents',
          hex: '#00a0e2',
          accentHex: '#d6ea28',
          priceDelta: 0
        },
        {
          id: 'kyalami-orange',
          name: 'Kyalami Orange / Black Extended Merino Leather',
          hex: '#d85d15',
          accentHex: '#181818',
          priceDelta: 0
        },
        {
          id: 'silverstone-black',
          name: 'Silverstone / Black Full Merino Leather',
          hex: '#d8dbdf',
          accentHex: '#111215',
          priceDelta: 2550
        },
        {
          id: 'black-merino',
          name: 'Black Extended Merino Leather with M tri-color stitching',
          hex: '#141416',
          accentHex: '#e2001a',
          priceDelta: 0
        }
      ],
      packages: [
        {
          id: 'm-carbon-exterior',
          name: 'M Carbon Exterior Package',
          description: 'Carbon fiber front air ducts, mirror caps, rear spoiler, and rear diffuser',
          price: 4700
        },
        {
          id: 'm-drivers-package',
          name: "M Driver's Package",
          description: 'Increases top speed governor to 180 mph and includes 1-day BMW M School voucher',
          price: 2500
        },
        {
          id: 'executive-pkg',
          name: 'Executive Package',
          description: 'Power tailgate, Remote Engine Start, Heated Steering Wheel, SensaTec dashboard',
          price: 1550
        }
      ],
      silhouetteType: 'sedan'
    },
    {
      id: 'm4-competition',
      name: 'BMW M4 Competition Coupé',
      series: 'M4 Series',
      bodyType: 'Coupé',
      tagline: 'Sculpted for Pure Velocity. The Coupe Reimagined.',
      badge: 'M Competition',
      badgeColor: '#e2001a',
      categories: ['all', 'm-power'],
      basePrice: 88300,
      priceFormatted: '$88,300',
      specs: {
        horsepower: 523,
        horsepowerDisplay: '523 hp',
        torque: '479 lb-ft @ 2,750-5,730 rpm',
        acceleration: 3.4,
        accelerationDisplay: '3.4s (0-60 mph)',
        topSpeed: '180 mph',
        powertrain: '3.0L M TwinPower Turbo inline 6-cylinder',
        transmission: '8-speed M Steptronic with Drivelogic',
        drivetrain: 'M xDrive with 2WD Drift Mode',
        fuelEconomy: '16 / 23 mpg',
        curbWeight: '3,979 lbs',
        electricRange: 'N/A (Combustion)',
        batteryCapacity: 'N/A'
      },
      dimensions: {
        length: '189.1 in',
        width: '74.3 in',
        height: '54.8 in',
        wheelbase: '112.5 in'
      },
      keyFeatures: [
        'Carbon Fiber Reinforced Plastic (CFRP) Roof',
        'Laserlight taillights with intricate 3D glass threads',
        'Optional M Carbon Bucket Racing Seats (-21 lbs)',
        'M Compound braking system with customizable pedal feel',
        'Frameless horizontal M kidney grille design'
      ],
      colors: [
        {
          id: 'sao-paulo-yellow',
          name: 'Sao Paulo Yellow',
          hex: '#d6ea28',
          secondaryHex: '#f1ff52',
          finish: 'Non-metallic',
          priceDelta: 0
        },
        {
          id: 'portimao-blue',
          name: 'Portimao Blue metallic',
          hex: '#154182',
          secondaryHex: '#255db0',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'toronto-red',
          name: 'Toronto Red metallic',
          hex: '#b31b25',
          secondaryHex: '#de2834',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'isle-of-man-green',
          name: 'Isle of Man Green metallic',
          hex: '#184738',
          secondaryHex: '#256d56',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'frozen-brilliant-white',
          name: 'Frozen Brilliant White metallic',
          hex: '#dfe3ea',
          secondaryHex: '#ffffff',
          finish: 'Frozen Matte',
          priceDelta: 3600
        },
        {
          id: 'black-sapphire',
          name: 'Black Sapphire metallic',
          hex: '#111317',
          secondaryHex: '#22252c',
          finish: 'Metallic',
          priceDelta: 0
        }
      ],
      wheels: [
        {
          id: 'style-826m-black',
          name: '19"/20" M Double-spoke Style 826 M Black',
          size: 'Front: 19x9.5 | Rear: 20x10.5',
          finish: 'Gloss Black',
          priceDelta: 0
        },
        {
          id: 'style-825m-silver',
          name: '19"/20" M Star-spoke Style 825 M Silver',
          size: 'Front: 19x9.5 | Rear: 20x10.5',
          finish: 'High-gloss Bright Silver',
          priceDelta: 1300
        },
        {
          id: 'style-827m-cs-gold',
          name: '19"/20" M Forged Style 827 M Bronze Gold (CS Spec)',
          size: 'Front: 19x9.5 | Rear: 20x10.5',
          finish: 'Matte Bronze Gold',
          priceDelta: 3100
        }
      ],
      interiors: [
        {
          id: 'fiona-red',
          name: 'Fiona Red / Black Full Merino Leather',
          hex: '#96151f',
          accentHex: '#141416',
          priceDelta: 2550
        },
        {
          id: 'yas-marina',
          name: 'Yas Marina Blue / Black Extended Merino Leather',
          hex: '#00a0e2',
          accentHex: '#d6ea28',
          priceDelta: 0
        },
        {
          id: 'black-merino',
          name: 'Black Extended Merino Leather',
          hex: '#141416',
          accentHex: '#e2001a',
          priceDelta: 0
        }
      ],
      packages: [
        {
          id: 'm-carbon-exterior',
          name: 'M Carbon Exterior Package',
          description: 'Front inlets, mirror covers, trunk lip spoiler, and diffuser insert in carbon fiber',
          price: 4700
        },
        {
          id: 'm-carbon-ceramic',
          name: 'M Carbon Ceramic Brakes',
          description: 'Gold-painted 6-piston calipers with 400mm carbon-ceramic rotors for fade-free track braking',
          price: 8500
        }
      ],
      silhouetteType: 'coupe'
    },
    {
      id: 'm5-sedan',
      name: 'All-New BMW M5 Sedan',
      series: 'M5 Series',
      bodyType: 'High-Performance Saloon',
      tagline: 'The Executive Icon, Electrified. 717 Horsepower Uncaged.',
      badge: 'M Hybrid Flagship',
      badgeColor: '#00a0e2',
      categories: ['all', 'm-power', 'luxury'],
      basePrice: 119500,
      priceFormatted: '$119,500',
      specs: {
        horsepower: 717,
        horsepowerDisplay: '717 hp (Combined)',
        torque: '738 lb-ft system torque',
        acceleration: 3.4,
        accelerationDisplay: '3.4s (0-60 mph)',
        topSpeed: '190 mph',
        powertrain: '4.4L M TwinPower Turbo V8 + M eDrive Electric Motor',
        transmission: '8-speed M Steptronic with Drivelogic',
        drivetrain: 'M xDrive with 4WD, 4WD Sport, and pure 2WD Modes',
        fuelEconomy: 'TBD Hybrid / High Efficiency Boost',
        curbWeight: '5,390 lbs',
        electricRange: 'Up to 25 miles pure electric',
        batteryCapacity: '18.6 kWh (usable)'
      },
      dimensions: {
        length: '200.6 in',
        width: '77.6 in',
        height: '59.4 in',
        wheelbase: '118.3 in'
      },
      keyFeatures: [
        'M HYBRID Drive System: V8 TwinTurbo paired with high-voltage e-motor',
        'Iconic BMW Curved Display with M-specific OS 8.5 & Boost Light',
        'Standard Integral Active Steering (rear-wheel steering up to 1.5°)',
        'M Carbon roof with contoured aerodynamic channel',
        'Active M Differential and Adaptive M Suspension with electronically controlled dampers'
      ],
      colors: [
        {
          id: 'marina-bay-blue',
          name: 'Marina Bay Blue metallic',
          hex: '#0d3b75',
          secondaryHex: '#1858a8',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'frozen-deep-grey',
          name: 'Frozen Deep Grey metallic',
          hex: '#303338',
          secondaryHex: '#484d54',
          finish: 'Frozen Matte',
          priceDelta: 3600
        },
        {
          id: 'isle-of-man-green',
          name: 'Isle of Man Green metallic',
          hex: '#184738',
          secondaryHex: '#256d56',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'carbon-black',
          name: 'Carbon Black metallic',
          hex: '#0b101d',
          secondaryHex: '#18243a',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'vegas-red',
          name: 'Vegas Red metallic',
          hex: '#8d1721',
          secondaryHex: '#bb212f',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'storm-bay',
          name: 'Storm Bay metallic',
          hex: '#5c646d',
          secondaryHex: '#79838f',
          finish: 'BMW Individual',
          priceDelta: 1950
        }
      ],
      wheels: [
        {
          id: 'style-951m-midnight',
          name: '20"/21" M Double-spoke 951 M Midnight Grey',
          size: 'Front: 20x10.5 | Rear: 21x11.0',
          finish: 'Midnight Grey Satin',
          priceDelta: 0
        },
        {
          id: 'style-951m-bicolor',
          name: '20"/21" M Double-spoke 951 M Bicolor Black',
          size: 'Front: 20x10.5 | Rear: 21x11.0',
          finish: 'Polished face with Jet Black pockets',
          priceDelta: 1200
        },
        {
          id: 'style-952m-gold',
          name: '20"/21" M Star-spoke 952 M Burnished Gold',
          size: 'Front: 20x10.5 | Rear: 21x11.0',
          finish: 'BMW Individual Burnished Gold',
          priceDelta: 2800
        }
      ],
      interiors: [
        {
          id: 'red-black-merino',
          name: 'BMW Individual Red / Black Extended Merino Leather',
          hex: '#881822',
          accentHex: '#131417',
          priceDelta: 0
        },
        {
          id: 'silverstone-merino',
          name: 'Silverstone / Black Full Merino Leather with Dark Violet contrast',
          hex: '#d5d8dc',
          accentHex: '#3d1f42',
          priceDelta: 2500
        },
        {
          id: 'black-merino-m5',
          name: 'Black Extended Merino Leather with embossed M logo',
          hex: '#141416',
          accentHex: '#00a0e2',
          priceDelta: 0
        }
      ],
      packages: [
        {
          id: 'm-carbon-pkg',
          name: 'M Carbon Package',
          description: 'M Carbon Roof, M Carbon Mirror caps, and rear M Carbon Gurney spoiler',
          price: 3100
        },
        {
          id: 'm-drivers-pkg',
          name: "M Driver's Package",
          description: 'Top speed increase to 190 mph + High-performance driving training session',
          price: 2500
        },
        {
          id: 'bowers-wilkins-sound',
          name: "Bowers & Wilkins Diamond Surround Sound System",
          description: '18 speakers, 655 watts, illuminated Nautilus tweeters',
          price: 1850
        }
      ],
      silhouetteType: 'sedan-large'
    },
    {
      id: 'i4-m50',
      name: 'BMW i4 M50 Gran Coupé',
      series: 'BMW i4 Series',
      bodyType: 'Gran Coupé',
      tagline: 'Electric Soul. M Performance DNA.',
      badge: 'BMW i / M',
      badgeColor: '#00a0e2',
      categories: ['all', 'bmw-i', 'm-power'],
      basePrice: 69700,
      priceFormatted: '$69,700',
      specs: {
        horsepower: 536,
        horsepowerDisplay: '536 hp (Sport Boost)',
        torque: '586 lb-ft immediate torque',
        acceleration: 3.7,
        accelerationDisplay: '3.7s (0-60 mph)',
        topSpeed: '140 mph (electronically limited)',
        powertrain: 'Dual BMW 5th Gen eDrive synchronous electric motors',
        transmission: 'Single-speed automatic with electronic selector',
        drivetrain: 'Electric all-wheel drive with near-actuator wheel slip limitation',
        fuelEconomy: '95 / 98 MPGe',
        curbWeight: '5,018 lbs',
        electricRange: 'Up to 269 miles (EPA est.)',
        batteryCapacity: '83.9 kWh (81.1 kWh net)'
      },
      dimensions: {
        length: '188.5 in',
        width: '72.9 in',
        height: '57.0 in',
        wheelbase: '112.4 in'
      },
      keyFeatures: [
        'Sport Boost mode unlocking full 536 hp & 586 lb-ft with launch control',
        'Adaptive M Suspension with specially configured springs and dampers',
        'Variable Sport Steering with speed-dependent assistance',
        'BMW IconicSounds Electric composed by Academy Award winner Hans Zimmer',
        'DC Fast Charging: 10% to 80% in 31 minutes at 205 kW'
      ],
      colors: [
        {
          id: 'frozen-portimao-blue',
          name: 'Frozen Portimao Blue metallic',
          hex: '#1e4884',
          secondaryHex: '#3069ba',
          finish: 'Frozen Matte',
          priceDelta: 3600
        },
        {
          id: 'san-remo-green',
          name: 'San Remo Green metallic',
          hex: '#234437',
          secondaryHex: '#356351',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'brooklyn-grey',
          name: 'Brooklyn Grey metallic',
          hex: '#747b85',
          secondaryHex: '#9097a2',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'sunset-orange',
          name: 'Sunset Orange metallic',
          hex: '#b34720',
          secondaryHex: '#d95a2d',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'mineral-white',
          name: 'Mineral White metallic',
          hex: '#eef1f5',
          secondaryHex: '#ffffff',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'black-sapphire',
          name: 'Black Sapphire metallic',
          hex: '#111317',
          secondaryHex: '#22252c',
          finish: 'Metallic',
          priceDelta: 0
        }
      ],
      wheels: [
        {
          id: 'style-860m-bicolor',
          name: '19" M Aerodynamic Wheels Style 860 M Bicolor',
          size: 'Front: 19x8.5 | Rear: 19x9.0',
          finish: 'Aerodynamic Bicolor with Midnight Grey',
          priceDelta: 0
        },
        {
          id: 'style-862i-individual',
          name: '20" BMW Individual Aerodynamic Style 862 I Bicolor',
          size: 'Front: 20x8.5 | Rear: 20x10.0',
          finish: 'High-gloss polished with titanium bronze inserts',
          priceDelta: 1900
        },
        {
          id: 'style-859m-yspoke',
          name: '19" M Y-spoke Style 859 M Bicolor Jet Black',
          size: 'Front: 19x8.5 | Rear: 19x9.0',
          finish: 'Jet Black Diamond Cut',
          priceDelta: 950
        }
      ],
      interiors: [
        {
          id: 'cognac-perforated',
          name: 'Cognac Perforated SensaTec with contrast stitching',
          hex: '#a35e2b',
          accentHex: '#181818',
          priceDelta: 0
        },
        {
          id: 'tacora-red-vernasca',
          name: 'Tacora Red Vernasca Leather with blue contrast',
          hex: '#8d1f27',
          accentHex: '#00a0e2',
          priceDelta: 1500
        },
        {
          id: 'oyster-vernasca',
          name: 'Oyster Vernasca Leather with grey accents',
          hex: '#e2dfd9',
          accentHex: '#303030',
          priceDelta: 1500
        },
        {
          id: 'black-blue-m',
          name: 'Black Vernasca Leather with blue M contrast stitching',
          hex: '#141416',
          accentHex: '#00a0e2',
          priceDelta: 1500
        }
      ],
      packages: [
        {
          id: 'm-sport-pro',
          name: 'M Sport Package Pro',
          description: 'M Sport Brakes with Red calipers, M Shadowline lights, M rear spoiler, extended high-gloss Shadowline',
          price: 2500
        },
        {
          id: 'parking-assistance',
          name: 'Parking Assistance Package',
          description: 'Surround View with 3D View, Drive Recorder, and Active Park Distance Control',
          price: 700
        },
        {
          id: 'harman-kardon',
          name: 'Harman Kardon Surround Sound',
          description: '16 speakers, 464-watt digital amplifier for pure acoustic fidelity',
          price: 875
        }
      ],
      silhouetteType: 'sedan'
    },
    {
      id: 'i7-xdrive60',
      name: 'BMW i7 xDrive60 Luxury Sedan',
      series: 'BMW 7 Series / BMW i',
      bodyType: 'Flagship Luxury Saloon',
      tagline: 'Forwardism. The Pinnacle of Electric Luxury.',
      badge: 'Electric Flagship',
      badgeColor: '#0066b1',
      categories: ['all', 'bmw-i', 'luxury'],
      basePrice: 124200,
      priceFormatted: '$124,200',
      specs: {
        horsepower: 536,
        horsepowerDisplay: '536 hp',
        torque: '549 lb-ft continuous torque',
        acceleration: 4.5,
        accelerationDisplay: '4.5s (0-60 mph)',
        topSpeed: '149 mph',
        powertrain: 'Dual electrically excited synchronous motors (Gen 5 eDrive)',
        transmission: 'Single-speed automatic with steering wheel Boost paddle',
        drivetrain: 'Intelligent Electric All-Wheel Drive',
        fuelEconomy: '87 / 92 MPGe',
        curbWeight: '5,917 lbs',
        electricRange: 'Up to 318 miles (EPA est.)',
        batteryCapacity: '105.7 kWh (101.7 kWh net)'
      },
      dimensions: {
        length: '212.2 in',
        width: '76.8 in',
        height: '60.8 in',
        wheelbase: '126.6 in'
      },
      keyFeatures: [
        '31.3" 8K BMW Theater Screen with Amazon Fire TV built into ceiling',
        'Automatic doors with touch / smartphone gesture opening',
        'BMW Interaction Bar with crystal glass faceted backlight',
        'Panoramic Sky Lounge LED Roof with dynamic light threads',
        'Two-axle air suspension with automatic self-leveling and active roll stabilization'
      ],
      colors: [
        {
          id: 'tanzanite-blue-7',
          name: 'Tanzanite Blue II metallic',
          hex: '#11254e',
          secondaryHex: '#1d3e7d',
          finish: 'BMW Individual',
          priceDelta: 1950
        },
        {
          id: 'oxide-grey',
          name: 'Oxide Grey metallic',
          hex: '#787773',
          secondaryHex: '#9a9893',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'aventurin-red',
          name: 'Aventurin Red metallic',
          hex: '#6a1b24',
          secondaryHex: '#8e2733',
          finish: 'BMW Individual',
          priceDelta: 1950
        },
        {
          id: 'dark-graphite',
          name: 'Dark Graphite metallic',
          hex: '#33363b',
          secondaryHex: '#4d5259',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'mineral-white-7',
          name: 'Mineral White metallic',
          hex: '#eef1f5',
          secondaryHex: '#ffffff',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'two-tone-sapphire-oxide',
          name: 'Two-Tone Black Sapphire / Oxide Grey metallic',
          hex: '#111317',
          secondaryHex: '#787773',
          finish: 'BMW Individual Two-Tone',
          priceDelta: 12000
        }
      ],
      wheels: [
        {
          id: 'style-910i-aero',
          name: '21" BMW Individual Aerodynamic 910 I Bicolor',
          size: 'Front: 21x9.0 | Rear: 21x10.5',
          finish: 'Diamond Cut with Dark Titanium Grey',
          priceDelta: 1800
        },
        {
          id: 'style-907m-aero',
          name: '20" M Aerodynamic 907 M Bicolor Jet Black',
          size: 'Front: 20x9.0 | Rear: 20x10.5',
          finish: 'Jet Black Gloss with high-sheen accents',
          priceDelta: 0
        },
        {
          id: 'style-908m-star',
          name: '21" M Star-spoke Style 908 M Jet Black',
          size: 'Front: 21x9.0 | Rear: 21x10.5',
          finish: 'Gloss Black with burnished accents',
          priceDelta: 2100
        }
      ],
      interiors: [
        {
          id: 'smoke-white-merino',
          name: 'BMW Individual Smoke White Full Merino Leather with Cashmere inlays',
          hex: '#ecefed',
          accentHex: '#9fa3a8',
          priceDelta: 7300
        },
        {
          id: 'tartufo-merino',
          name: 'BMW Individual Tartufo Full Merino Leather',
          hex: '#7e4726',
          accentHex: '#181818',
          priceDelta: 5450
        },
        {
          id: 'amarone-merino',
          name: 'Amarone Full Merino Leather with fine wood Oak Mirror finish',
          hex: '#4f1a26',
          accentHex: '#84693a',
          priceDelta: 5450
        },
        {
          id: 'black-merino-7',
          name: 'Black Extended Merino Leather with Carbon / Silver Thread trim',
          hex: '#141416',
          accentHex: '#3b3d40',
          priceDelta: 0
        }
      ],
      packages: [
        {
          id: 'rear-executive-lounge',
          name: 'Rear Executive Lounge Seating Package',
          description: 'Reclining passenger rear seat with integrated leg rest, 4-zone climate, rear center console with wireless charging',
          price: 7250
        },
        {
          id: 'bowers-wilkins-4d',
          name: 'Bowers & Wilkins Diamond 4D Surround Sound System',
          description: '39 speakers, 1,965 watts with 4D bass exciters built directly into headrests and seats',
          price: 4800
        },
        {
          id: 'executive-pkg-7',
          name: 'Executive Package',
          description: 'Automatic doors, crystal headlights with Swarovski glass, front massaging seats',
          price: 4600
        }
      ],
      silhouetteType: 'sedan-large'
    },
    {
      id: 'ix-m60',
      name: 'BMW iX M60 Sports Activity Vehicle',
      series: 'BMW iX Series',
      bodyType: 'Sports Activity Vehicle (SAV)',
      tagline: 'Born Electric. Elevated by M. Pure Monolithic Power.',
      badge: 'SAV / M Electric',
      badgeColor: '#00a0e2',
      categories: ['all', 'bmw-i', 'bmw-x'],
      basePrice: 111500,
      priceFormatted: '$111,500',
      specs: {
        horsepower: 610,
        horsepowerDisplay: '610 hp (Launch Mode)',
        torque: '811 lb-ft peak torque',
        acceleration: 3.6,
        accelerationDisplay: '3.6s (0-60 mph)',
        topSpeed: '155 mph',
        powertrain: 'Dual high-output current-excited synchronous electric motors',
        transmission: 'Single-speed automatic with M Launch Control',
        drivetrain: 'Electric all-wheel drive with M-tuned differential lock logic',
        fuelEconomy: '77 / 80 MPGe',
        curbWeight: '5,769 lbs',
        electricRange: 'Up to 296 miles (EPA est.)',
        batteryCapacity: '111.5 kWh (106.3 kWh net)'
      },
      dimensions: {
        length: '195.0 in',
        width: '77.4 in',
        height: '66.8 in',
        wheelbase: '118.1 in'
      },
      keyFeatures: [
        'Carbon Cage structure utilizing Carbon Fiber Reinforced Polymer (CFRP)',
        'M-specific adaptive 2-axle air suspension with active damper control',
        'Self-healing kidney grille intelligence panel with radar & heating elements',
        'Electrochromic panoramic glass roof (Sky Lounge with liquid crystal tinting)',
        'Integral Active Steering with up to 3.2° rear-wheel steering angle'
      ],
      colors: [
        {
          id: 'storm-bay-ix',
          name: 'Storm Bay metallic',
          hex: '#5a626b',
          secondaryHex: '#77808c',
          finish: 'BMW Individual',
          priceDelta: 1950
        },
        {
          id: 'oxide-grey-ix',
          name: 'Oxide Grey metallic',
          hex: '#787773',
          secondaryHex: '#9a9893',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'phytonic-blue',
          name: 'Phytonic Blue metallic',
          hex: '#163d6b',
          secondaryHex: '#255896',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'blue-ridge-mountain',
          name: 'Blue Ridge Mountain metallic',
          hex: '#47656d',
          secondaryHex: '#608691',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'mineral-white-ix',
          name: 'Mineral White metallic',
          hex: '#eef1f5',
          secondaryHex: '#ffffff',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'black-sapphire-ix',
          name: 'Black Sapphire metallic',
          hex: '#111317',
          secondaryHex: '#22252c',
          finish: 'Metallic',
          priceDelta: 0
        }
      ],
      wheels: [
        {
          id: 'style-1021-bronze',
          name: '22" M Aero Bi-color Bronze Style 1021',
          size: 'Front/Rear: 22x9.5',
          finish: 'Bi-color Titanium Bronze with aerodynamic flaps',
          priceDelta: 1950
        },
        {
          id: 'style-1020-bicolor',
          name: '22" BMW Individual Aero Style 1020 Bicolor',
          size: 'Front/Rear: 22x9.5',
          finish: 'Jet Black diamond polished with aerodynamic inserts',
          priceDelta: 1950
        },
        {
          id: 'style-1012-aero',
          name: '21" Aero Style 1012 Bicolor',
          size: 'Front/Rear: 21x9.0',
          finish: 'Orbit Grey machine polished',
          priceDelta: 0
        }
      ],
      interiors: [
        {
          id: 'castanea-chestnut',
          name: 'Amido Olive Leaf Tanned Natural Leather',
          hex: '#2b2f33',
          accentHex: '#b28e5d',
          priceDelta: 3500
        },
        {
          id: 'castanea-leather',
          name: 'Castanea Chestnut Natural Leather with Bronze trim',
          hex: '#643224',
          accentHex: '#b28e5d',
          priceDelta: 3500
        },
        {
          id: 'oyster-perforated-ix',
          name: 'Perforated Microfiber / Wool Blend in Stone Grey',
          hex: '#a6a8aa',
          accentHex: '#40454a',
          priceDelta: 0
        },
        {
          id: 'black-sensatec-ix',
          name: 'Black Perforated SensaTec with Gold Bronze highlights',
          hex: '#141416',
          accentHex: '#b28e5d',
          priceDelta: 0
        }
      ],
      packages: [
        {
          id: 'radiant-heat-pkg',
          name: 'Radiant Heat Package',
          description: 'Infrared heating panels in door armrests, center armrests, lower instrument panel, and steering wheel',
          price: 1600
        },
        {
          id: 'bowers-wilkins-ix',
          name: 'Bowers & Wilkins Diamond Surround Sound System',
          description: '30 speakers with 1,615 watts and 4D shakers in the front seat cushions',
          price: 3400
        }
      ],
      silhouetteType: 'suv'
    },
    {
      id: 'x5-m-competition',
      name: 'BMW X5 M Competition',
      series: 'BMW X Series / M',
      bodyType: 'Sports Activity Vehicle (SAV)',
      tagline: 'Colossal Power Meets Dominant Versatility.',
      badge: 'M SAV Competition',
      badgeColor: '#e2001a',
      categories: ['all', 'bmw-x', 'm-power'],
      basePrice: 124800,
      priceFormatted: '$124,800',
      specs: {
        horsepower: 617,
        horsepowerDisplay: '617 hp',
        torque: '553 lb-ft @ 1,800-5,860 rpm',
        acceleration: 3.7,
        accelerationDisplay: '3.7s (0-60 mph)',
        topSpeed: '177 mph',
        powertrain: '4.4L M TwinPower Turbo V8 with 48V Mild-Hybrid e-motor',
        transmission: '8-speed M Steptronic with Drivelogic',
        drivetrain: 'M xDrive Intelligent All-Wheel Drive with Active M Differential',
        fuelEconomy: '13 / 18 mpg',
        curbWeight: '5,455 lbs',
        electricRange: 'N/A (Mild Hybrid 48V)',
        batteryCapacity: '0.44 kWh (48V mild hybrid)'
      },
      dimensions: {
        length: '194.8 in',
        width: '79.5 in',
        height: '69.4 in',
        wheelbase: '117.0 in'
      },
      keyFeatures: [
        'M-specific 48V mild-hybrid system providing instant off-the-line electric torque',
        'Adaptive M Suspension Professional with active roll stabilization',
        'Staggered 21" front / 22" rear light alloy wheels for maximum mechanical grip',
        'M Quad Exhaust System with electronically controlled flaps and black chrome tips',
        'Iconic Glow illuminated BMW kidney grille with horizontal double slats'
      ],
      colors: [
        {
          id: 'isle-of-man-green-x5',
          name: 'Isle of Man Green metallic',
          hex: '#184738',
          secondaryHex: '#256d56',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'marina-bay-blue-x5',
          name: 'Marina Bay Blue metallic',
          hex: '#0d3b75',
          secondaryHex: '#1858a8',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'toronto-red-x5',
          name: 'Toronto Red metallic',
          hex: '#b31b25',
          secondaryHex: '#de2834',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'dravit-grey-x5',
          name: 'Dravit Grey metallic',
          hex: '#3f4145',
          secondaryHex: '#5e6167',
          finish: 'BMW Individual',
          priceDelta: 1950
        },
        {
          id: 'frozen-pure-grey-x5',
          name: 'Frozen Pure Grey metallic',
          hex: '#696e75',
          secondaryHex: '#888f98',
          finish: 'Frozen Matte',
          priceDelta: 3600
        },
        {
          id: 'carbon-black-x5',
          name: 'Carbon Black metallic',
          hex: '#0b101d',
          secondaryHex: '#18243a',
          finish: 'Metallic',
          priceDelta: 0
        }
      ],
      wheels: [
        {
          id: 'style-809m-bicolor',
          name: '21"/22" M Star-spoke Style 809 M Bicolor',
          size: 'Front: 21x10.5 | Rear: 22x11.5',
          finish: 'Bicolor Jet Black with diamond polish',
          priceDelta: 0
        },
        {
          id: 'style-818m-black',
          name: '21"/22" M Double-spoke Style 818 M Black',
          size: 'Front: 21x10.5 | Rear: 22x11.5',
          finish: 'Gloss Solid Black',
          priceDelta: 1100
        },
        {
          id: 'style-808m-silver',
          name: '21"/22" M V-spoke Style 808 M Silver',
          size: 'Front: 21x10.5 | Rear: 22x11.5',
          finish: 'Bright Silver Burnished',
          priceDelta: 1300
        }
      ],
      interiors: [
        {
          id: 'silverstone-black-x5',
          name: 'Silverstone / Black Full Merino Leather',
          hex: '#d5d8dc',
          accentHex: '#141416',
          priceDelta: 3500
        },
        {
          id: 'sakhir-orange-x5',
          name: 'Sakhir Orange / Black Full Merino Leather',
          hex: '#b83b28',
          accentHex: '#141416',
          priceDelta: 3500
        },
        {
          id: 'taruma-brown-x5',
          name: 'Taruma Brown Full Merino Leather',
          hex: '#5d3824',
          accentHex: '#141416',
          priceDelta: 3500
        },
        {
          id: 'black-merino-x5',
          name: 'Black Extended Merino Leather with Alcantara Headliner',
          hex: '#141416',
          accentHex: '#e2001a',
          priceDelta: 0
        }
      ],
      packages: [
        {
          id: 'm-drivers-pkg-x5',
          name: "M Driver's Package",
          description: 'Increased top track speed to 177 mph and included high-speed driving course',
          price: 2500
        },
        {
          id: 'executive-pkg-x5',
          name: 'Executive Package',
          description: 'Panoramic Sky Lounge LED Roof, Rear Manual Side Window Shades, Heated/Cooled Cupholders, Front Massaging Seats',
          price: 3100
        },
        {
          id: 'bowers-wilkins-x5',
          name: 'Bowers & Wilkins Diamond Surround Sound System',
          description: '20 speakers, 1,475-watt amplifier with studio-level sound profiling',
          price: 3400
        }
      ],
      silhouetteType: 'suv'
    },
    {
      id: '760i-xdrive',
      name: 'BMW 760i xDrive Sedan',
      series: 'BMW 7 Series',
      bodyType: 'Flagship Luxury Saloon',
      tagline: 'Commanding Prestige. Mastercrafted V8 Presence.',
      badge: 'V8 Flagship',
      badgeColor: '#c5a059',
      categories: ['all', 'luxury'],
      basePrice: 121300,
      priceFormatted: '$121,300',
      specs: {
        horsepower: 536,
        horsepowerDisplay: '536 hp',
        torque: '553 lb-ft @ 1,800-5,400 rpm',
        acceleration: 4.1,
        accelerationDisplay: '4.1s (0-60 mph)',
        topSpeed: '155 mph',
        powertrain: '4.4L BMW TwinPower Turbo V8 with 48V Mild Hybrid',
        transmission: '8-speed Sport Automatic with Sport and Manual shift modes',
        drivetrain: 'xDrive Intelligent All-Wheel Drive',
        fuelEconomy: '18 / 26 mpg',
        curbWeight: '4,969 lbs',
        electricRange: 'N/A (Mild Hybrid 48V)',
        batteryCapacity: '0.44 kWh (48V mild hybrid)'
      },
      dimensions: {
        length: '212.2 in',
        width: '76.8 in',
        height: '60.8 in',
        wheelbase: '126.6 in'
      },
      keyFeatures: [
        'BMW Curved Display paired with BMW Interaction Bar',
        'Available 31.3" 8K BMW Theater Screen with Bowers & Wilkins audio',
        'Integral Active Steering with standard 2-axle self-leveling air suspension',
        'Illuminated Kidney Grille with crystal headlights accented by Swarovski elements',
        'Executive Lounge Seating with continuous leg rest and 42.5° recline'
      ],
      colors: [
        {
          id: 'carbon-black-760',
          name: 'Carbon Black metallic',
          hex: '#0b101d',
          secondaryHex: '#18243a',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'dravit-grey-760',
          name: 'Dravit Grey metallic',
          hex: '#3f4145',
          secondaryHex: '#5e6167',
          finish: 'BMW Individual',
          priceDelta: 1950
        },
        {
          id: 'tanzanite-blue-760',
          name: 'Tanzanite Blue II metallic',
          hex: '#11254e',
          secondaryHex: '#1d3e7d',
          finish: 'BMW Individual',
          priceDelta: 1950
        },
        {
          id: 'oxide-grey-760',
          name: 'Oxide Grey metallic',
          hex: '#787773',
          secondaryHex: '#9a9893',
          finish: 'Metallic',
          priceDelta: 0
        },
        {
          id: 'brooklyn-grey-760',
          name: 'Brooklyn Grey metallic',
          hex: '#747b85',
          secondaryHex: '#9097a2',
          finish: 'Metallic',
          priceDelta: 0
        }
      ],
      wheels: [
        {
          id: 'style-907m-760',
          name: '20" M Aerodynamic Style 907 M Bicolor Jet Black',
          size: 'Front: 20x9.0 | Rear: 20x10.5',
          finish: 'Polished face with Jet Black accents',
          priceDelta: 0
        },
        {
          id: 'style-910i-760',
          name: '21" BMW Individual Style 910 I Dark Titanium',
          size: 'Front: 21x9.0 | Rear: 21x10.5',
          finish: 'Dark Titanium Grey burnished',
          priceDelta: 1800
        }
      ],
      interiors: [
        {
          id: 'tartufo-merino-760',
          name: 'BMW Individual Tartufo Full Merino Leather',
          hex: '#7e4726',
          accentHex: '#181818',
          priceDelta: 5450
        },
        {
          id: 'smoke-white-760',
          name: 'BMW Individual Smoke White Merino Leather',
          hex: '#ecefed',
          accentHex: '#8e9297',
          priceDelta: 5450
        },
        {
          id: 'black-merino-760',
          name: 'Black Extended Merino Leather',
          hex: '#141416',
          accentHex: '#42454a',
          priceDelta: 0
        }
      ],
      packages: [
        {
          id: 'rear-executive-760',
          name: 'Rear Executive Lounge Package',
          description: 'Electric reclining lounge seat, touch screen door remotes, rear wireless charging',
          price: 7250
        },
        {
          id: 'luxury-rear-seating',
          name: 'Luxury Rear Seating Package',
          description: 'Ventilated and massaging rear seats with multifunction contouring',
          price: 2100
        }
      ],
      silhouetteType: 'sedan-large'
    }
  ];

  // Helper querying and formatting utilities
  const BMWDataService = {
    getCategories() {
      return [...CATEGORIES];
    },

    getAllModels() {
      return [...MODELS_DATA];
    },

    getModelsByCategory(categoryId) {
      if (!categoryId || categoryId === 'all') {
        return [...MODELS_DATA];
      }
      return MODELS_DATA.filter(model => model.categories.includes(categoryId));
    },

    getModelById(id) {
      return MODELS_DATA.find(model => model.id === id) || null;
    },

    getComparisonModels(ids = []) {
      if (!ids || ids.length === 0) {
        // default comparison set
        return [MODELS_DATA[0], MODELS_DATA[2], MODELS_DATA[3]];
      }
      return ids.map(id => this.getModelById(id)).filter(Boolean);
    },

    calculateConfiguredPrice(modelId, { colorId, wheelId, interiorId, packageIds = [] } = {}) {
      const model = this.getModelById(modelId);
      if (!model) return { total: 0, formatted: '$0', breakdown: [] };

      let total = model.basePrice;
      const breakdown = [{ item: `Base MSRP: ${model.name}`, price: model.basePrice }];

      if (colorId) {
        const color = model.colors.find(c => c.id === colorId);
        if (color && color.priceDelta > 0) {
          total += color.priceDelta;
          breakdown.push({ item: `Exterior Paint: ${color.name}`, price: color.priceDelta });
        }
      }

      if (wheelId) {
        const wheel = model.wheels.find(w => w.id === wheelId);
        if (wheel && wheel.priceDelta > 0) {
          total += wheel.priceDelta;
          breakdown.push({ item: `Wheel Package: ${wheel.name}`, price: wheel.priceDelta });
        }
      }

      if (interiorId) {
        const interior = model.interiors.find(i => i.id === interiorId);
        if (interior && interior.priceDelta > 0) {
          total += interior.priceDelta;
          breakdown.push({ item: `Upholstery: ${interior.name}`, price: interior.priceDelta });
        }
      }

      if (packageIds && packageIds.length > 0) {
        packageIds.forEach(pkgId => {
          const pkg = model.packages.find(p => p.id === pkgId);
          if (pkg) {
            total += pkg.price;
            breakdown.push({ item: `Option: ${pkg.name}`, price: pkg.price });
          }
        });
      }

      return {
        total,
        formatted: '$' + total.toLocaleString('en-US'),
        breakdown
      };
    }
  };

  // Expose to global window / Node module
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CATEGORIES, MODELS_DATA, BMWDataService };
  }
  if (typeof global !== 'undefined') {
    global.BMW_CATEGORIES = CATEGORIES;
    global.BMW_MODELS_DATA = MODELS_DATA;
    global.BMWDataService = BMWDataService;
  }
})(typeof window !== 'undefined' ? window : globalThis);
