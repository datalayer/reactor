import type { ReactElement } from 'react';
import { FormControl, SegmentedControl, Text } from '@primer/react';
import { CheckCircleFillIcon, DeviceDesktopIcon, MoonIcon, SunIcon } from '@primer/octicons-react';
import {
  Box, DatalayerThemeProvider, themeConfigs, themeVariants,
  exportPortableTheme, useSystemColorMode, useThemeStore,
  type ColorMode, type PortableTheme, type ThemeVariant,
} from '@datalayer/primer-addons';

type WebsiteTheme={id:string;name:string;slug:string;description:string};
type SiteAppearance={theme:ThemeVariant;colorMode:ColorMode};
type AppearanceSettingsProps={websiteThemes:WebsiteTheme[];activeWebsiteTheme?:string;onActivateWebsiteTheme:(theme:WebsiteTheme)=>void;siteAppearance?:SiteAppearance;onSiteAppearanceChange?:(theme:ThemeVariant,colorMode:ColorMode,portable:PortableTheme)=>void};

export function AppearanceSettings({websiteThemes,activeWebsiteTheme,onActivateWebsiteTheme,siteAppearance,onSiteAppearanceChange}:AppearanceSettingsProps):ReactElement{
 const{colorMode,theme,setColorMode,setTheme}=useThemeStore();
 const systemMode=useSystemColorMode();
 const selectedTheme=siteAppearance?.theme??theme;
 const selectedColorMode=siteAppearance?.colorMode??colorMode;
 const resolvedMode=selectedColorMode==='auto'?systemMode:selectedColorMode;
 const modes:ColorMode[]=['light','dark','auto'];
 const updateMode=(next:ColorMode)=>siteAppearance&&onSiteAppearanceChange?onSiteAppearanceChange(selectedTheme,next,exportPortableTheme(selectedTheme)):setColorMode(next);
 const updateTheme=(next:ThemeVariant)=>siteAppearance&&onSiteAppearanceChange?onSiteAppearanceChange(next,selectedColorMode,exportPortableTheme(next)):setTheme(next,false);
 return <Box sx={{maxWidth:960,width:'100%',mx:'auto'}}>
  <h2 className="appearance-title">Appearance</h2>
  <Text as="p" sx={{color:'fg.muted',mb:4,fontSize:1}}>{siteAppearance?'Manage how this public Astro website looks to visitors. The selected Primer functional tokens are exported as reusable CSS variables.':'Manage how Reactor CMS looks to you. Select a theme and choose between light mode, dark mode, or follow your operating system preference.'}</Text>
  <Box className="appearance-section">
   <FormControl><FormControl.Label>Color mode</FormControl.Label><FormControl.Caption>Choose light, dark, or let the app follow your operating system setting.</FormControl.Caption></FormControl>
   <Box sx={{mt:3}}><SegmentedControl aria-label="Color mode" onChange={index=>updateMode(modes[index])}><SegmentedControl.Button selected={selectedColorMode==='light'} leadingIcon={SunIcon}>Light</SegmentedControl.Button><SegmentedControl.Button selected={selectedColorMode==='dark'} leadingIcon={MoonIcon}>Dark</SegmentedControl.Button><SegmentedControl.Button selected={selectedColorMode==='auto'} leadingIcon={DeviceDesktopIcon}>Auto</SegmentedControl.Button></SegmentedControl></Box>
  </Box>
  <h3 className="appearance-heading">{siteAppearance?'Website palette':'Application theme'}</h3>
  <Text as="p" sx={{color:'fg.muted',mb:3,fontSize:1}}>Choose a Primer colour palette. Each preview adapts to the color mode selected above.{siteAppearance?' The light and dark functional CSS variables are saved with the site.':''}</Text>
  <Box className="theme-grid">{themeVariants.map((variant:ThemeVariant)=>{const config=themeConfigs[variant],active=variant===selectedTheme;return <Box key={variant} as="button" className={`theme-card${active?' selected':''}`} onClick={()=>updateTheme(variant)}>
   {active&&<Box className="theme-check"><CheckCircleFillIcon size={20}/></Box>}
   <DatalayerThemeProvider colorMode={resolvedMode} theme={config.primerTheme} themeStyles={config.themeStyles}><Box className="theme-preview"><Box className="preview-bar"><i/><i/><i/></Box><Box sx={{p:3,bg:'canvas.default'}}><Text sx={{display:'block',fontWeight:'semibold',color:'fg.default',mb:1}}>The quick brown fox</Text><Text sx={{display:'block',fontSize:0,color:'fg.muted',mb:2}}>jumps over the lazy dog.</Text><Box sx={{display:'flex',gap:1}}><span className="preview-pill accent">accent</span><span className="preview-pill success">success</span></Box></Box></Box></DatalayerThemeProvider>
   <Text sx={{display:'block',fontWeight:'semibold',fontSize:2,mb:1}}>{config.label}</Text><Text sx={{color:'fg.muted',fontSize:1}}>{config.description}</Text>
  </Box>})}</Box>
  <h3 className="appearance-heading website-heading">Astro layout theme</h3>
  <Text as="p" sx={{color:'fg.muted',mb:3,fontSize:1}}>Select the structural layout used by the public Astro website. Its colors come from the portable Primer palette above.</Text>
  <Box className="website-theme-grid">{websiteThemes.map(item=><button key={item.id} className={`website-theme-card${activeWebsiteTheme===item.slug?' selected':''}`} onClick={()=>onActivateWebsiteTheme(item)}><span className={`website-swatch ${item.slug}`}/><span><strong>{item.name}</strong><small>{item.description}</small></span>{activeWebsiteTheme===item.slug&&<CheckCircleFillIcon size={20}/>}</button>)}</Box>
 </Box>
}
