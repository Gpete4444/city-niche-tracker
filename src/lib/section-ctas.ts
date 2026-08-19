/** Default section foot CTAs → lead form / phone. */

export function defaultSectionCtaPrompt(variant: string): string {
  switch (variant) {
    case 'cost':
      return 'Want a number for your home?';
    case 'materials':
      return 'Questions on materials?';
    case 'timeline':
      return 'Need a schedule that fits?';
    case 'codes':
      return 'Need help with permits?';
    case 'diyVsPro':
    case 'diy':
      return 'Not sure DIY vs pro?';
    case 'whenToCall':
      return 'Seeing warning signs?';
    case 'scope':
      return 'Want a clearer scope?';
    case 'areas':
      return 'Outside these locations?';
    case 'process':
      return 'Ready to start?';
    case 'whyChooseUs':
      return 'Have a project in mind?';
    default:
      return 'Questions about this?';
  }
}
