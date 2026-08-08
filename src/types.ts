export type ShowType =
  | 'support'      // opening on someone else's tour
  | 'headline'     // our own show
  | 'festival'
  | 'radio'        // station visit, lounge performance, radio show
  | 'in-store'
  | 'tv'
  | 'webcast'
  | 'private'      // corporate, wedding, industry showcase
  | 'rehearsal';   // not a show, but part of the routing

export interface Leg {
  id: string;
  name: string;             // "Matchbox Twenty — North Tour"
  shortName: string;        // "MB20" — for the filter rail
  artist: string;           // who I was playing for
  billing?: string;         // who we supported, if applicable
  startDate: string;        // ISO
  endDate: string;
  color: string;            // hex
  note?: string;            // one line of context
}

export interface Venue {
  id: string;
  name: string;             // '' = venue unknown; the show still renders
  city: string;
  state: string;            // two-letter
  lat: number;
  lng: number;
  capacity?: number;
  address?: string;
}

export interface Show {
  id: string;
  legId: string;
  venueId: string;
  date: string;             // ISO
  type: ShowType;
  doors?: string;           // "18:30"
  setTime?: string;
  setLength?: string;       // "30 min"
  note?: string;
  photos?: string[];        // filenames, relative to /public/photos/{showId}/
  confirmed: boolean;       // false = in the record but unverified
}
