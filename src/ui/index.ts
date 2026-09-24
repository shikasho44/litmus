/**
 * UI kit barrel. Import from here in scenes:
 *   import { Button, DialogueBox, Stamp, EvidenceCard } from '../../ui';
 * See docs/frontend.md for the catalogue.
 */
export { Button, IconButton, type ButtonProps, type ButtonVariant, type IconButtonProps } from './Button';
export { Icon, type IconProps } from './Icon';
export { ICONS, ICON_KEYS, CATEGORY_ICON, resolveIcon, type IconName } from './icons';
export { Panel, Tabs, TabPanel, tabId, panelId, type PanelProps, type TabItem, type TabsProps } from './Panel';
export { Modal, type ModalProps } from './Modal';
export { BottomSheet, type BottomSheetProps } from './BottomSheet';
export { toast, ToastHost, type ToastTone } from './Toast';
export { Tooltip } from './Tooltip';
export { DialogueBox, skipText, skipTextTick, TEXT_SPEED_MS, SPEAKER_NAME, type DialogueBoxProps } from './DialogueBox';
export { Stamp, STAMP_META, type StampProps } from './Stamp';
export { CutIn, type CutInProps, type CutInTone } from './CutIn';
export { EvidenceCard, factTitle, importanceLabel, type EvidenceCardProps } from './EvidenceCard';
export { CaseTag, type CaseTagProps } from './CaseTag';
export { ShardPortrait, type ShardPortraitProps } from './ShardPortrait';
export { makeShards, JANE_SILHOUETTE } from './shards';
export { HolmaSprite, type HolmaSpriteProps, type HolmaFraming } from './HolmaSprite';
export { HolmaVector } from './HolmaVector';
export { GlitchText, SpeedLines } from './GlitchText';
export { Slider, Switch, Segmented } from './Controls';
export { StageLayout, type StageLayoutProps } from './StageLayout';
export { portalRoot, useDialog, focusables } from './dialog';
