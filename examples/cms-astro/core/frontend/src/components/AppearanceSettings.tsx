import type { ReactElement } from 'react';
import { FormControl, SegmentedControl, Text } from '@primer/react';
import { CheckCircleFillIcon, DeviceDesktopIcon, LinkExternalIcon, MoonIcon, SunIcon } from '@primer/octicons-react';
import {
  Box, DatalayerThemeProvider, themeConfigs, themeVariants,
  exportPortableTheme, useSystemColorMode, useThemeStore,
  type ColorMode, type PortableTheme, type ThemeVariant,
} from '@datalayer/primer-addons';

type WebsiteTheme={id:string;name:string;slug:string;description:string};
type SiteAppearance={theme:ThemeVariant;colorMode:ColorMode};
type AppearanceSettingsProps={
  websiteThemes?:WebsiteTheme[];
  activeWebsiteTheme?:string;
  previewUrl?:string;
  siteAppearance?:SiteAppearance;
  onWebsiteThemeChange?:(theme:WebsiteTheme,appearanceTheme:ThemeVariant,portable:PortableTheme)=>void;
  onSiteAppearanceChange?:(theme:ThemeVariant,colorMode:ColorMode,portable:PortableTheme)=>void;
};

function ThemeCards({selected,colorMode,onSelect}:{selected:ThemeVariant;colorMode:'light'|'dark';onSelect:(theme:ThemeVariant)=>void}):ReactElement{
 return <Box className="theme-grid">{themeVariants.map((variant:ThemeVariant)=>{const config=themeConfigs[variant],active=variant===selected;return <Box key={variant} as="button" className={`theme-card${active?' selected':''}`} onClick={()=>onSelect(variant)}>
  {active&&<Box className="theme-check"><CheckCircleFillIcon size={20}/></Box>}
  <DatalayerThemeProvider colorMode={colorMode} theme={config.primerTheme} themeStyles={config.themeStyles}><Box className="theme-preview"><Box className="preview-bar"><i/><i/><i/></Box><Box sx={{p:3,bg:'canvas.default'}}><Text sx={{display:'block',fontWeight:'semibold',color:'fg.default',mb:1}}>The quick brown fox</Text><Text sx={{display:'block',fontSize:0,color:'fg.muted',mb:2}}>jumps over the lazy dog.</Text><Box sx={{display:'flex',gap:1}}><span className="preview-pill accent">accent</span><span className="preview-pill success">success</span></Box></Box></Box></DatalayerThemeProvider>
  <Text sx={{display:'block',fontWeight:'semibold',fontSize:2,mb:1}}>{config.label}</Text><Text sx={{color:'fg.muted',fontSize:1}}>{config.description}</Text>
 </Box>})}</Box>
}

export function AppearanceSettings({websiteThemes=[],activeWebsiteTheme,previewUrl,siteAppearance,onWebsiteThemeChange,onSiteAppearanceChange}:AppearanceSettingsProps):ReactElement{
 const{colorMode,theme,setColorMode,setTheme}=useThemeStore();
 const systemMode=useSystemColorMode();
 const selectedTheme=siteAppearance?.theme??theme;
 const selectedColorMode=siteAppearance?.colorMode??colorMode;
 const resolvedMode=selectedColorMode==='auto'?systemMode:selectedColorMode;
 const modes:ColorMode[]=['light','dark','auto'];
 const updateMode=(next:ColorMode)=>siteAppearance&&onSiteAppearanceChange?onSiteAppearanceChange(selectedTheme,next,exportPortableTheme(selectedTheme)):setColorMode(next);
 const selectWebsiteTheme=(next:WebsiteTheme)=>onWebsiteThemeChange?.(next,selectedTheme,exportPortableTheme(selectedTheme));
 const selectDatalayerTheme=(next:ThemeVariant)=>onSiteAppearanceChange?.(next,selectedColorMode,exportPortableTheme(next));

 return <Box sx={{maxWidth:1100,width:'100%',mx:'auto'}}>
  <h2 className="appearance-title">Appearance</h2>
  <Text as="p" sx={{color:'fg.muted',mb:4,fontSize:1}}>{siteAppearance?'Choose the theme and color mode visitors will see on this website.':'Manage how Reactor CMS looks to you. Select a theme and choose between light mode, dark mode, or your operating system preference.'}</Text>
  <Box className="appearance-section">
   <FormControl><FormControl.Label>Color mode</FormControl.Label><FormControl.Caption>{siteAppearance?"Choose light, dark, or let the website follow the visitor's operating system setting.":'Choose light, dark, or follow your operating system setting.'}</FormControl.Caption></FormControl>
   <Box sx={{mt:3}}><SegmentedControl aria-label="Color mode" onChange={index=>updateMode(modes[index])}><SegmentedControl.Button selected={selectedColorMode==='light'} leadingIcon={SunIcon}>Light</SegmentedControl.Button><SegmentedControl.Button selected={selectedColorMode==='dark'} leadingIcon={MoonIcon}>Dark</SegmentedControl.Button><SegmentedControl.Button selected={selectedColorMode==='auto'} leadingIcon={DeviceDesktopIcon}>Auto</SegmentedControl.Button></SegmentedControl></Box>
  </Box>

  {siteAppearance?<>
   <h3 className="appearance-heading">Datalayer theme</h3>
   <Text as="p" sx={{color:'fg.muted',mb:3,fontSize:1}}>Choose the exported Datalayer theme applied to the public website. Its portable functional tokens provide the colors for both light and dark mode.</Text>
   <ThemeCards selected={selectedTheme} colorMode={resolvedMode} onSelect={selectDatalayerTheme}/>
   <h3 className="appearance-heading website-heading">Astro layout</h3>
   <Text as="p" sx={{color:'fg.muted',mb:3,fontSize:1}}>Choose the page structure. The Datalayer theme selected above supplies its color palette and typeface.</Text>
   <Box className="website-theme-grid">{websiteThemes.map(item=><button type="button" key={item.id} className={`website-theme-card${activeWebsiteTheme===item.slug?' selected':''}`} onClick={()=>selectWebsiteTheme(item)}><span className={`website-swatch ${item.slug}`}/><span><strong>{item.name}</strong><small>{item.description}</small></span>{activeWebsiteTheme===item.slug&&<CheckCircleFillIcon size={20}/>}</button>)}</Box>
   {previewUrl&&<Box className="website-preview-section">
    <Box className="website-preview-heading"><Box><h3 className="appearance-heading">Homepage preview</h3><Text as="p" sx={{color:'fg.muted',m:0,fontSize:1}}>This is the current public homepage with the selected theme applied.</Text></Box><a className="site-link" href={previewUrl} target="_blank" rel="noreferrer">Open website <LinkExternalIcon/></a></Box>
    <Box className="website-preview-frame"><Box className="website-preview-bar"><i/><i/><i/><span>{previewUrl}</span></Box><iframe key={`${previewUrl}-${activeWebsiteTheme}-${selectedTheme}-${selectedColorMode}`} src={previewUrl} title="Website homepage preview"/></Box>
   </Box>}
  </>:<>
   <h3 className="appearance-heading">Application theme</h3>
   <Text as="p" sx={{color:'fg.muted',mb:3,fontSize:1}}>Choose the theme used by your CMS management interface.</Text>
   <ThemeCards selected={selectedTheme} colorMode={resolvedMode} onSelect={variant=>setTheme(variant,false)}/>
  </>}
 </Box>
}
