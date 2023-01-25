import estherImg from "$assets/headshots/esther.jpg";
import sophiaImg from "$assets/headshots/sophia.png";
import ladaImg from "$assets/headshots/lada.jpg";
import nastassjaImg from "$assets/headshots/nastassja.jpg";
import sarahImg from "$assets/headshots/sarah.jpg";

const title = "About Us";
const subtitle =
  "We're an engineer-led team of student founders from the University of Pennsylvania.";
const body = "";

const people = [
  {
    name: "Esther Amao",
    bio: [
      "B.S.E. from SEAS in Computer Engineering '23",
      "M.S.E from SEAS in Robotics '24",
    ],
    picture: estherImg,
  },
  {
    name: "Sophia Anzai Takahashi",
    bio: [
      "B.S.E. from SEAS in Mechanical Engineering '23",
      "B.S.E from Wharton in Management '23",
    ],
    picture: sophiaImg,
  },
  {
    name: "Lada Korotaeva",
    bio: ["B.S.E. from SEAS in Mechanical Engineering '23"],
    picture: ladaImg,
  },
  {
    name: "Nastassja Kuznetsova",
    bio: [
      "B.S.E. from SEAS in Computer Engineering '23",
      "M.S.E. from SEAS in Data Science '24",
    ],
    picture: nastassjaImg,
  },
  {
    name: "Sarah Tadlock",
    bio: [
    "B.S.E. from SEAS in Mechanical Engineering 2023"
    ],
    picture: sarahImg,
  },
];

const data = {
  title,
  subtitle,
  body,
  people,
};

export default data;
