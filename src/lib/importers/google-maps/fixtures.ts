export function createGoogleResponse() {
  const root = [
    null,
    null,
    null,
    ["Ada", "avatar", "owner-id"],
    "A life in places",
    null,
    null,
    null,
    [
      [null, [null, null, "Hanoi, Vietnam", null, null, [null, null, 21.0285, 105.8542], null, "ChIJHanoi"], "Hanoi"],
      [null, [null, null, "", null, "Shinjuku, Tokyo", [null, null, 35.6762, 139.6503], null, "ChIJTokyo"], "Tokyo"],
      [null, [null, null, "Unknown address"], "Place without coordinates"],
    ],
  ];
  return `)]}'\n${JSON.stringify([root])}`;
}
